package ru.fross.messenger

import android.Manifest
import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.graphics.Typeface
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.view.View
import android.webkit.CookieManager
import android.webkit.PermissionRequest
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView
import android.widget.Toast

class MainActivity : Activity() {
    private lateinit var webView: WebView
    private lateinit var splash: LinearLayout
    private lateinit var progress: ProgressBar
    private lateinit var status: TextView
    private lateinit var detail: TextView
    private lateinit var retry: Button
    private var fileCallback: ValueCallback<Array<Uri>>? = null
    private var pendingWebPermission: PermissionRequest? = null
    private val handler = Handler(Looper.getMainLooper())
    private var loadTimedOut = false

    companion object {
        private const val SITE = "https://fross-messenger.boberbuset132013.workers.dev/"
        private const val FILE_CHOOSER = 4102
        private const val MEDIA_PERMISSION = 4103
        private const val SITE_HOST = "fross-messenger.boberbuset132013.workers.dev"
        private const val PURPLE = 0xFF8B35F5.toInt()
        private const val BG = 0xFF090611.toInt()
    }

    private val timeout = Runnable {
        if (webView.visibility != View.VISIBLE) showError("Сайт отвечает слишком долго", "Проверь подключение к интернету и попробуй ещё раз.")
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.statusBarColor = BG
        window.navigationBarColor = BG
        buildScreen()

        CookieManager.getInstance().setAcceptCookie(true)
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, true)

        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            loadsImagesAutomatically = true
            javaScriptCanOpenWindowsAutomatically = true
            setSupportMultipleWindows(false)
            allowFileAccess = false
            allowContentAccess = true
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            mediaPlaybackRequiresUserGesture = false
            userAgentString = "$userAgentString FROSSAndroid/1.0.0"
        }

        webView.webViewClient = object : WebViewClient() {
            override fun onPageStarted(view: WebView, url: String, favicon: android.graphics.Bitmap?) {
                super.onPageStarted(view, url, favicon)
                showLoading("Подключаемся к FROSS…")
                loadTimedOut = false
                handler.removeCallbacks(timeout)
                handler.postDelayed(timeout, 25000)
            }

            override fun onPageFinished(view: WebView, url: String) {
                super.onPageFinished(view, url)
                handler.removeCallbacks(timeout)
                loadTimedOut = false
                splash.visibility = View.GONE
                webView.visibility = View.VISIBLE
            }

            override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
                super.onReceivedError(view, request, error)
                if (request.isForMainFrame) {
                    handler.removeCallbacks(timeout)
                    showError("Не удалось загрузить FROSS", "Проверь интернет-соединение. Код ошибки: ${error.errorCode}")
                }
            }

            override fun onReceivedHttpError(view: WebView, request: WebResourceRequest, errorResponse: android.webkit.WebResourceResponse) {
                super.onReceivedHttpError(view, request, errorResponse)
                if (request.isForMainFrame && errorResponse.statusCode >= 500) {
                    handler.removeCallbacks(timeout)
                    showError("Сервер временно недоступен", "Код HTTP: ${errorResponse.statusCode}. Попробуй позже.")
                }
            }

            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val uri = request.url
                if (uri.scheme == "https" && (uri.host == SITE_HOST || uri.host == "fross-ca5d6.firebaseapp.com")) return false
                if (uri.scheme == "mailto" || uri.scheme == "tel" || uri.scheme == "https") {
                    try {
                        startActivity(Intent(Intent.ACTION_VIEW, uri))
                    } catch (_: ActivityNotFoundException) {
                        Toast.makeText(this@MainActivity, "Не удалось открыть ссылку", Toast.LENGTH_SHORT).show()
                    }
                    return true
                }
                return true
            }
        }

        webView.webChromeClient = object : WebChromeClient() {
            override fun onProgressChanged(view: WebView, newProgress: Int) {
                super.onProgressChanged(view, newProgress)
                if (splash.visibility == View.VISIBLE) {
                    progress.progress = newProgress
                    status.text = when {
                        newProgress < 20 -> "Подключаемся к FROSS…"
                        newProgress < 55 -> "Загружаем приложение…"
                        newProgress < 85 -> "Подготавливаем интерфейс…"
                        else -> "Почти готово…"
                    }
                    detail.text = "$newProgress% • Пожалуйста, подожди"
                }
            }

            override fun onShowFileChooser(view: WebView, callback: ValueCallback<Array<Uri>>, params: FileChooserParams): Boolean {
                fileCallback?.onReceiveValue(null)
                fileCallback = callback
                return try {
                    startActivityForResult(params.createIntent(), FILE_CHOOSER)
                    true
                } catch (_: Exception) {
                    fileCallback = null
                    Toast.makeText(this@MainActivity, "Не удалось открыть выбор файла", Toast.LENGTH_SHORT).show()
                    false
                }
            }

            override fun onPermissionRequest(request: PermissionRequest) {
                runOnUiThread {
                    val originHost = runCatching { Uri.parse(request.origin.toString()).host }.getOrNull()
                    if (originHost != SITE_HOST) {
                        request.deny()
                        return@runOnUiThread
                    }
                    val requested = request.resources.toSet()
                    val needsAudio = requested.contains(PermissionRequest.RESOURCE_AUDIO_CAPTURE)
                    val needsVideo = requested.contains(PermissionRequest.RESOURCE_VIDEO_CAPTURE)
                    val permissions = mutableListOf<String>()
                    if (needsAudio && checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) permissions.add(Manifest.permission.RECORD_AUDIO)
                    if (needsVideo && checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) permissions.add(Manifest.permission.CAMERA)
                    if (permissions.isEmpty()) request.grant(request.resources) else {
                        pendingWebPermission?.deny()
                        pendingWebPermission = request
                        requestPermissions(permissions.toTypedArray(), MEDIA_PERMISSION)
                    }
                }
            }
        }

        if (savedInstanceState == null) loadSite() else {
            val restored = webView.restoreState(savedInstanceState)
            if (restored == null) loadSite() else {
                splash.visibility = View.GONE
                webView.visibility = View.VISIBLE
            }
        }
    }

    private fun buildScreen() {
        val root = FrameLayout(this).apply { setBackgroundColor(BG) }
        webView = WebView(this).apply { visibility = View.GONE }
        splash = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setPadding(dp(28), dp(32), dp(28), dp(32))
            setBackgroundColor(BG)
        }
        val logo = TextView(this).apply {
            text = "◉"
            textSize = 92f
            setTextColor(PURPLE)
            gravity = Gravity.CENTER
            typeface = Typeface.DEFAULT_BOLD
        }
        val brand = TextView(this).apply {
            text = "FROSS"
            textSize = 34f
            letterSpacing = 0.16f
            setTextColor(Color.WHITE)
            gravity = Gravity.CENTER
            typeface = Typeface.DEFAULT_BOLD
        }
        val subtitle = TextView(this).apply {
            text = "MESSENGER"
            textSize = 15f
            letterSpacing = 0.22f
            setTextColor(0xFFBDA2FF.toInt())
            gravity = Gravity.CENTER
        }
        status = TextView(this).apply {
            text = "Запускаем FROSS…"
            textSize = 18f
            setTextColor(Color.WHITE)
            gravity = Gravity.CENTER
            setPadding(0, dp(54), 0, dp(8))
        }
        detail = TextView(this).apply {
            text = "Пожалуйста, подожди"
            textSize = 13f
            setTextColor(0xFFAAA1BB.toInt())
            gravity = Gravity.CENTER
            setPadding(0, dp(8), 0, dp(16))
        }
        progress = ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal).apply {
            isIndeterminate = false
            max = 100
            progress = 0
            progressTintList = android.content.res.ColorStateList.valueOf(PURPLE)
            progressBackgroundTintList = android.content.res.ColorStateList.valueOf(0xFF292035.toInt())
        }
        retry = Button(this).apply {
            text = "Повторить"
            visibility = View.GONE
            setOnClickListener { loadSite() }
        }
        splash.addView(logo, LinearLayout.LayoutParams(-1, dp(112)))
        splash.addView(brand, LinearLayout.LayoutParams(-1, -2))
        splash.addView(subtitle, LinearLayout.LayoutParams(-1, -2))
        splash.addView(status, LinearLayout.LayoutParams(-1, -2))
        splash.addView(detail, LinearLayout.LayoutParams(-1, -2))
        splash.addView(progress, LinearLayout.LayoutParams(-1, dp(7)))
        splash.addView(retry, LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(20) })
        root.addView(webView, FrameLayout.LayoutParams(-1, -1))
        root.addView(splash, FrameLayout.LayoutParams(-1, -1))
        setContentView(root)
    }

    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()

    private fun showLoading(message: String) {
        splash.visibility = View.VISIBLE
        webView.visibility = View.GONE
        status.text = message
        detail.text = "Подготавливаем мессенджер…"
        progress.progress = 0
        retry.visibility = View.GONE
    }

    private fun showError(title: String, message: String) {
        handler.removeCallbacks(timeout)
        splash.visibility = View.VISIBLE
        webView.visibility = View.GONE
        status.text = title
        detail.text = message
        progress.progress = 0
        retry.visibility = View.VISIBLE
    }

    private fun loadSite() {
        showLoading("Подключаемся к FROSS…")
        webView.loadUrl(SITE)
    }

    @Deprecated("Legacy activity result API is retained for Android compatibility")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == FILE_CHOOSER) {
            val result = if (resultCode == Activity.RESULT_OK && data != null) WebChromeClient.FileChooserParams.parseResult(resultCode, data) else null
            fileCallback?.onReceiveValue(result)
            fileCallback = null
        }
    }

    @Deprecated("Legacy permission callback supports the minimum Android API")
    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == MEDIA_PERMISSION) {
            val request = pendingWebPermission
            pendingWebPermission = null
            if (request != null) {
                val audioOk = !request.resources.contains(PermissionRequest.RESOURCE_AUDIO_CAPTURE) || checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED
                val videoOk = !request.resources.contains(PermissionRequest.RESOURCE_VIDEO_CAPTURE) || checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED
                if (audioOk && videoOk) request.grant(request.resources) else request.deny()
            }
        }
    }

    override fun onSaveInstanceState(outState: Bundle) {
        webView.saveState(outState)
        super.onSaveInstanceState(outState)
    }

    @Suppress("DEPRECATION")
    override fun onBackPressed() {
        if (::webView.isInitialized && webView.canGoBack()) webView.goBack() else super.onBackPressed()
    }

    override fun onDestroy() {
        handler.removeCallbacksAndMessages(null)
        fileCallback?.onReceiveValue(null)
        pendingWebPermission?.deny()
        webView.stopLoading()
        webView.destroy()
        super.onDestroy()
    }
}

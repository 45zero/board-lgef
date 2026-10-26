package com.lgef.calendrier;

import android.content.Intent;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.ViewGroup;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    /** Écran du board à ouvrir (ex. /?app=mails), posé par une notification affichée par l'appli. */
    public static final String EXTRA_ROUTE = "lgef_route";

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        keepAboveKeyboard();
        openRoute(getIntent());
    }

    /**
     * Android 15+ (bord à bord imposé) : la fenêtre n'est plus réduite à l'ouverture du clavier et
     * les marges posées par Capacitor (adjustMarginsForEdgeToEdge) ne comptent que les barres
     * système, si bien que la zone de saisie passait sous le clavier. Même réglage, clavier compris.
     */
    private void keepAboveKeyboard() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.VANILLA_ICE_CREAM || getBridge() == null) return;
        View webView = getBridge().getWebView();
        ViewCompat.setOnApplyWindowInsetsListener(webView, (v, windowInsets) -> {
            Insets bars = windowInsets.getInsets(WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout());
            Insets ime = windowInsets.getInsets(WindowInsetsCompat.Type.ime());
            ViewGroup.MarginLayoutParams mlp = (ViewGroup.MarginLayoutParams) v.getLayoutParams();
            mlp.leftMargin = bars.left;
            mlp.topMargin = bars.top;
            mlp.rightMargin = bars.right;
            mlp.bottomMargin = Math.max(bars.bottom, ime.bottom);
            v.setLayoutParams(mlp);
            return WindowInsetsCompat.CONSUMED;
        });
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        openRoute(intent);
    }

    private void openRoute(Intent intent) {
        if (intent == null || getBridge() == null) return;
        String route = intent.getStringExtra(EXTRA_ROUTE);
        intent.removeExtra(EXTRA_ROUTE);
        // Chemin interne seulement (« /… »), jamais une adresse extérieure.
        if (route == null || !route.startsWith("/") || route.startsWith("//")) return;
        String base = getBridge().getServerUrl();
        if (base == null) return;
        String url = base.replaceAll("/+$", "") + route;
        getBridge().getWebView().post(() -> getBridge().getWebView().loadUrl(url));
    }
}

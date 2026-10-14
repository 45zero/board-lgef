package com.lgef.calendrier;

import android.content.Intent;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    /** Écran du board à ouvrir (ex. /?app=mails), posé par une notification affichée par l'appli. */
    public static final String EXTRA_ROUTE = "lgef_route";

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        openRoute(getIntent());
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

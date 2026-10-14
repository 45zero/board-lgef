package com.lgef.calendrier;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.drawable.Drawable;
import android.os.Build;
import androidx.annotation.NonNull;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;
import com.capacitorjs.plugins.pushnotifications.MessagingService;
import com.google.firebase.messaging.RemoteMessage;
import java.util.Map;

/**
 * Réception des push. Les messages « native_notification » (mails, voir send_push_v1 et
 * /api/cron/mail-push) sont affichés par l'appli elle-même : petite icône, vignette en couleurs
 * (logo Gmail), objet et début du mail sur plusieurs lignes. Le reste suit le plugin Capacitor.
 */
public class BoardMessagingService extends MessagingService {

    @Override
    public void onMessageReceived(@NonNull RemoteMessage message) {
        Map<String, String> data = message.getData();
        if ("1".equals(data.get("native_notification"))) showNative(data);
        super.onMessageReceived(message);
    }

    private void showNative(Map<String, String> data) {
        String channel = data.containsKey("n_channel") ? data.get("n_channel") : "push_default";
        ensureChannel(channel);

        int small = getResources().getIdentifier(data.get("n_icon"), "drawable", getPackageName());
        if (small == 0) small = getResources().getIdentifier("ic_stat_lgef", "drawable", getPackageName());

        String title = data.containsKey("n_title") ? data.get("n_title") : "Board LGEF";
        String body = data.containsKey("n_body") ? data.get("n_body") : "";
        int id = (int) (System.currentTimeMillis() & 0x7fffffff);

        // Toucher : ouvre l'écran indiqué (ex. /?app=mails) dans l'appli.
        Intent intent = new Intent(this, MainActivity.class);
        intent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        intent.putExtra(MainActivity.EXTRA_ROUTE, data.get("route"));
        PendingIntent pending = PendingIntent.getActivity(this, id, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, channel)
            .setSmallIcon(small)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_EMAIL)
            .setAutoCancel(true)
            .setContentIntent(pending);
        try {
            builder.setColor(Color.parseColor(data.get("n_color")));
        } catch (Exception ignored) {
            // couleur absente ou invalide : teinte par défaut
        }
        if ("gmail".equals(data.get("large_icon"))) {
            Bitmap large = bitmap(R.drawable.ic_large_gmail, 192);
            if (large != null) builder.setLargeIcon(large);
        }
        try {
            NotificationManagerCompat.from(this).notify(id, builder.build());
        } catch (SecurityException ignored) {
            // notifications refusées par l'utilisateur
        }
    }

    /** Canal créé au besoin (l'appli ne les crée qu'après connexion). */
    private void ensureChannel(String id) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager == null || manager.getNotificationChannel(id) != null) return;
        String name = "mail".equals(id) ? "Mails" : "Notifications";
        manager.createNotificationChannel(new NotificationChannel(id, name, NotificationManager.IMPORTANCE_HIGH));
    }

    private Bitmap bitmap(int res, int size) {
        Drawable drawable = ContextCompat.getDrawable(this, res);
        if (drawable == null) return null;
        Bitmap bmp = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888);
        Canvas canvas = new Canvas(bmp);
        drawable.setBounds(0, 0, size, size);
        drawable.draw(canvas);
        return bmp;
    }
}

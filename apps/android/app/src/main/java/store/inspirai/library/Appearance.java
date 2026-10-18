package store.inspirai.library;
import android.content.*;
import android.content.res.Configuration;
import android.graphics.Color;
public final class Appearance {
 public static String mode(Context c){return c.getSharedPreferences("appearance",0).getString("mode","system");}
 public static void set(Context c,String m){if(!java.util.Arrays.asList("system","light","dark").contains(m))throw new IllegalArgumentException("theme");c.getSharedPreferences("appearance",0).edit().putString("mode",m).apply();}
 public static boolean dark(Context c){String m=mode(c);return m.equals("dark")||(m.equals("system")&&(c.getApplicationContext().getResources().getConfiguration().uiMode&Configuration.UI_MODE_NIGHT_MASK)==Configuration.UI_MODE_NIGHT_YES);}
 public static Context wrap(Context c){Configuration cfg=new Configuration(c.getResources().getConfiguration());String m=mode(c);if(!m.equals("system"))cfg.uiMode=(cfg.uiMode&~Configuration.UI_MODE_NIGHT_MASK)|(m.equals("dark")?Configuration.UI_MODE_NIGHT_YES:Configuration.UI_MODE_NIGHT_NO);return c.createConfigurationContext(cfg);}
 private static int color(Context c,String light,String dark){return Color.parseColor(dark(c)?dark:light);}
 public static int background(Context c){return color(c,"#F6F5F1","#161615");}
 public static int surface(Context c){return color(c,"#FFFFFF","#232321");}
 public static int ink(Context c){return color(c,"#1C1C1E","#F4F2EC");}
 public static int muted(Context c){return color(c,"#6C6C70","#ABA9A2");}
 public static int accent(Context c){return color(c,"#A85705","#F2A33A");}
 public static int line(Context c){return color(c,"#E5E3DD","#393935");}
 public static String title(Context c){return switch(mode(c)){case "light"->"日间";case "dark"->"夜间";default->"跟随系统";};}
}

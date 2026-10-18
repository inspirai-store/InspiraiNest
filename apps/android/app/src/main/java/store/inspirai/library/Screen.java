package store.inspirai.library;
import android.app.*;
import android.content.*;
import android.os.*;
import android.graphics.Typeface;
import android.graphics.drawable.*;
import android.content.res.ColorStateList;
import android.view.*;
import android.widget.*;
import java.util.concurrent.*;

public abstract class Screen extends Activity {
 protected final ExecutorService io=Executors.newSingleThreadExecutor();
 protected LinearLayout root,body,heading;
 protected ScrollView scroll;
 protected TextView status;
 protected int ink,green;
 private String themeAtCreation;
 private boolean appliedDark;
 @Override protected void attachBaseContext(Context c){super.attachBaseContext(Appearance.wrap(c));}
 @Override public void onCreate(Bundle state){setTheme(Appearance.dark(this)?R.style.AppTheme_Dark:R.style.AppTheme);super.onCreate(state);if(Build.VERSION.SDK_INT>=33)getOnBackInvokedDispatcher().registerOnBackInvokedCallback(android.window.OnBackInvokedDispatcher.PRIORITY_DEFAULT,this::backAction);themeAtCreation=Appearance.mode(this);appliedDark=Appearance.dark(this);ink=Appearance.ink(this);green=Appearance.accent(this);}
 @Override protected void onResume(){super.onResume();if(themeAtCreation!=null&&!themeAtCreation.equals(Appearance.mode(this))){syncAppearance();onAppearanceChanged();}}
 protected void syncAppearance(){themeAtCreation=Appearance.mode(this);appliedDark=Appearance.dark(this);setTheme(Appearance.dark(this)?R.style.AppTheme_Dark:R.style.AppTheme);ink=Appearance.ink(this);green=Appearance.accent(this);if(root!=null)root.setBackgroundColor(Appearance.background(this));getWindow().setStatusBarColor(Appearance.background(this));getWindow().setNavigationBarColor(Appearance.background(this));getWindow().getDecorView().setSystemUiVisibility(Appearance.dark(this)?0:View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR|View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR);}
 protected void onAppearanceChanged(){recreate();}
 @Override public void onConfigurationChanged(android.content.res.Configuration c){super.onConfigurationChanged(c);boolean changed=appliedDark!=Appearance.dark(this);syncAppearance();if(changed)onAppearanceChanged();}
 protected void backAction(){finish();}
 @android.annotation.SuppressLint("GestureBackNavigation") @Override public void onBackPressed(){backAction();}
 protected int dp(int n){return Math.round(n*getResources().getDisplayMetrics().density);}
 protected void shell(){
  root=new LinearLayout(this);root.setOrientation(LinearLayout.VERTICAL);root.setBackgroundColor(Appearance.background(this));
  root.setOnApplyWindowInsetsListener((v,i)->{if(Build.VERSION.SDK_INT>=30){android.graphics.Insets a=i.getInsets(WindowInsets.Type.systemBars()|WindowInsets.Type.ime());v.setPadding(a.left,a.top,a.right,a.bottom);}else v.setPadding(0,i.getSystemWindowInsetTop(),0,i.getSystemWindowInsetBottom());return i;});
  getWindow().setStatusBarColor(Appearance.background(this));getWindow().setNavigationBarColor(Appearance.background(this));
  getWindow().getDecorView().setSystemUiVisibility(Appearance.dark(this)?0:View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR|View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR);setContentView(root);
 }
 protected void page(String title,String subtitle){
  shell();heading=new LinearLayout(this);heading.setOrientation(LinearLayout.VERTICAL);heading.setPadding(dp(24),dp(12),dp(24),dp(14));root.addView(heading);
  if(!(this instanceof MainActivity))back(heading);
  heading.addView(label(title,28,true));if(subtitle!=null&&!subtitle.isEmpty()){TextView h=label(subtitle,13,false);h.setTextColor(Appearance.muted(this));heading.addView(h);}
  status=label("",14,false);status.setPadding(dp(24),dp(8),dp(24),dp(8));status.setVisibility(View.GONE);root.addView(status);
  scroll=new ScrollView(this);scroll.setFillViewport(true);root.addView(scroll,new LinearLayout.LayoutParams(-1,0,1));body=new LinearLayout(this);body.setOrientation(LinearLayout.VERTICAL);body.setPadding(dp(24),dp(8),dp(24),dp(24));scroll.addView(body);
 }
 protected void back(LinearLayout p){Button b=button(p,"返回",this::finish);b.setGravity(Gravity.START|Gravity.CENTER_VERTICAL);b.setCompoundDrawablesRelativeWithIntrinsicBounds(Icons.drawable(this,"back",green),null,null,null);b.setCompoundDrawablePadding(dp(8));b.setBackgroundColor(android.graphics.Color.TRANSPARENT);}
 protected TextView label(String text,int size,boolean bold){TextView v=new TextView(this);v.setText(text);v.setTextSize(size);v.setTextColor(ink);v.setPadding(0,dp(5),0,dp(5));v.setLineSpacing(0,1.25f);if(bold)v.setTypeface(Typeface.create("sans-serif-medium",Typeface.NORMAL));return v;}
 protected EditText input(String hint,String text,boolean multi){TextView caption=label(hint,13,true);caption.setTextColor(Appearance.muted(this));body.addView(caption);EditText v=new EditText(this);v.setHint(hint);v.setText(text);v.setTextSize(16);v.setTextColor(ink);v.setHintTextColor(Appearance.muted(this));v.setSingleLine(!multi);v.setMinHeight(dp(52));if(multi){v.setMinLines(3);v.setGravity(Gravity.TOP);}v.setPadding(dp(14),dp(14),dp(14),dp(14));v.setBackground(cardBackground());LinearLayout.LayoutParams p=new LinearLayout.LayoutParams(-1,-2);p.setMargins(0,dp(4),0,dp(16));body.addView(v,p);return v;}
 protected GradientDrawable cardBackground(){GradientDrawable b=new GradientDrawable();b.setColor(Appearance.surface(this));b.setCornerRadius(dp(22));b.setStroke(dp(1),Appearance.line(this));return b;}
 protected Button button(LinearLayout parent,String text,Runnable action){Button v=new Button(this);v.setText(text);v.setTextSize(15);v.setAllCaps(false);v.setStateListAnimator(null);v.setElevation(0);v.setTextColor(green);v.setMinHeight(dp(48));v.setPadding(dp(16),dp(8),dp(16),dp(8));v.setBackground(new RippleDrawable(ColorStateList.valueOf(Appearance.line(this)),cardBackground(),null));LinearLayout.LayoutParams p=new LinearLayout.LayoutParams(-1,-2);p.setMargins(0,dp(4),0,dp(4));String art=text.startsWith("扫码")?"scan":text.startsWith("新建采集")?"collect":text.contains("应用更新")||text.contains("安装更新")?"update":null;if(art!=null){v.setCompoundDrawablesRelativeWithIntrinsicBounds(Icons.drawable(this,art,green),null,null,null);v.setCompoundDrawablePadding(dp(12));}parent.addView(v,p);v.setOnClickListener(w->action.run());return v;}
 protected void primary(Button b){GradientDrawable bg=cardBackground();bg.setColor(green);b.setBackground(new RippleDrawable(ColorStateList.valueOf(Appearance.line(this)),bg,null));b.setTextColor(Appearance.dark(this)?Appearance.background(this):android.graphics.Color.WHITE);}
 protected LinearLayout card(LinearLayout parent){LinearLayout c=new LinearLayout(this);c.setOrientation(LinearLayout.VERTICAL);c.setPadding(dp(18),dp(14),dp(18),dp(14));c.setBackground(cardBackground());LinearLayout.LayoutParams p=new LinearLayout.LayoutParams(-1,-2);p.setMargins(0,0,0,dp(14));parent.addView(c,p);return c;}
 protected void rule(LinearLayout p){View v=new View(this);v.setBackgroundColor(Appearance.line(this));p.addView(v,new LinearLayout.LayoutParams(-1,dp(1)));}
 protected void appearance(){String[] modes={"system","light","dark"};roundedDialog(new AlertDialog.Builder(this).setTitle("外观").setSingleChoiceItems(new String[]{"跟随系统","日间","夜间"},java.util.Arrays.asList(modes).indexOf(Appearance.mode(this)),(d,i)->{Appearance.set(this,modes[i]);d.dismiss();syncAppearance();onAppearanceChanged();}).setNegativeButton("取消",null).create());}
 protected void notice(String text){if(status!=null){status.setText(text);status.setVisibility(text==null||text.isEmpty()?View.GONE:View.VISIBLE);}}
 protected void fail(Exception e){notice(e.getMessage()==null?"操作失败，请重试；本机内容仍保留。":e.getMessage());}
 protected void ui(Runnable r){runOnUiThread(()->{if(!isFinishing()&&!isDestroyed())r.run();});}
 protected interface Work<T>{T run()throws Exception;}
 protected interface Done<T>{void run(T value)throws Exception;}
 protected <T> void work(Work<T> task,Done<T> done){io.execute(()->{try{T v=task.run();ui(()->{try{done.run(v);}catch(Exception e){fail(e);}});}catch(Exception e){ui(()->fail(e));}});}
 protected void roundedDialog(AlertDialog dialog){dialog.setOnShowListener(v->{GradientDrawable bg=cardBackground();bg.setCornerRadius(dp(28));dialog.getWindow().setBackgroundDrawable(bg);});dialog.show();}
 protected void confirm(String message,Runnable action){roundedDialog(new AlertDialog.Builder(this).setMessage(message).setNegativeButton("取消",null).setPositiveButton("确认",(d,w)->action.run()).create());}
 @Override protected void onDestroy(){io.shutdown();super.onDestroy();}
}

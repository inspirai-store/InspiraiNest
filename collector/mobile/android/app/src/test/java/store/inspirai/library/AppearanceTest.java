package store.inspirai.library;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.os.Bundle;
import org.junit.*;
import org.junit.runner.RunWith;
import org.robolectric.*;
import org.robolectric.annotation.Config;
import org.robolectric.android.controller.ActivityController;
import static org.junit.Assert.*;
@RunWith(RobolectricTestRunner.class) @Config(sdk=35)
public class AppearanceTest {
 @After public void reset(){Appearance.set(RuntimeEnvironment.getApplication(),"system");}
 @Test public void bothThemesMeetTextContrast(){Context c=RuntimeEnvironment.getApplication();for(String mode:new String[]{"light","dark"}){Appearance.set(c,mode);for(int bg:new int[]{Appearance.background(c),Appearance.surface(c)})for(int fg:new int[]{Appearance.ink(c),Appearance.muted(c),Appearance.accent(c)})assertTrue(mode+" text contrast",contrast(fg,bg)>=4.5);}}
 @Test public void changingThemeKeepsDurableComposition()throws Exception {Context c=RuntimeEnvironment.getApplication();Appearance.set(c,"light");Intent i=new Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT,"主题切换保留原文\nhttps://example.com");ActivityController<ShareActivity> first=Robolectric.buildActivity(ShareActivity.class,i).setup();Bundle state=new Bundle();first.saveInstanceState(state);String id=state.getString("draftId");first.pause().stop().destroy();Appearance.set(c,"dark");ActivityController<ShareActivity> second=Robolectric.buildActivity(ShareActivity.class,i).create(state).start().resume();try{assertTrue(Appearance.dark(second.get()));assertEquals("主题切换保留原文\nhttps://example.com",new Drafts(c).read(id).getString("original"));assertEquals("dark",Appearance.mode(second.get()));}finally{second.pause().stop().destroy();new Drafts(c).remove(id);}}
 private static double luminance(int c){double[] v={Color.red(c)/255.0,Color.green(c)/255.0,Color.blue(c)/255.0};for(int i=0;i<3;i++)v[i]=v[i]<=.04045?v[i]/12.92:Math.pow((v[i]+.055)/1.055,2.4);return .2126*v[0]+.7152*v[1]+.0722*v[2];}
 private static double contrast(int a,int b){double x=luminance(a),y=luminance(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);}
}

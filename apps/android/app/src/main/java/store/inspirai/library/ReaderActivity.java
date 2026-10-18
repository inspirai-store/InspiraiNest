package store.inspirai.library;
import android.content.Intent;
import android.os.Bundle;
import android.widget.LinearLayout;
public class ReaderActivity extends Screen {
 private LibraryPane pane;
 @Override public void onCreate(Bundle state){super.onCreate(state);shell();pane=new LibraryPane(this,getIntent().getStringExtra("entry"),deep->{});root.addView(pane.web,new LinearLayout.LayoutParams(-1,0,1));}
 @Override protected void onAppearanceChanged(){if(pane!=null)pane.applyTheme();}
 @Override protected void backAction(){if(pane==null||!pane.back())super.backAction();}
 @Override protected void onActivityResult(int q,int r,Intent data){super.onActivityResult(q,r,data);if(pane!=null)pane.result(q,r,data);}
 @Override protected void onDestroy(){if(pane!=null)pane.destroy();super.onDestroy();}
}

package store.inspirai.library;

import android.app.AlertDialog;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.provider.Settings;
import android.widget.*;
import androidx.core.content.FileProvider;
import store.inspirai.library.core.AppUpdate;

public class UpdateActivity extends Screen {
    private AppUpdate.Release release;
    private Button check,install;
    private ProgressBar progress;
    private boolean busy,waitingPermission;
    @Override public void onCreate(Bundle state){
        super.onCreate(state);page("应用更新","当前版本 "+BuildConfig.VERSION_NAME);
        body.addView(label("从当前配置的服务器获取更新，覆盖安装会保留登录和本机草稿。",15,false));
        progress=new ProgressBar(this,null,android.R.attr.progressBarStyleHorizontal);progress.setMax(100);body.addView(progress);
        check=button(body,"检查更新",()->check(false));
        install=button(body,"下载并安装更新",this::download);install.setEnabled(false);
        primary(install);
        check(state==null&&getIntent().getBooleanExtra("download",false));
    }
    private void buttons(boolean loading){busy=loading;check.setEnabled(!loading);install.setEnabled(!loading&&release!=null&&release.newerThan(BuildConfig.VERSION_CODE));}
    private void check(boolean autoDownload){
        if(busy)return;buttons(true);notice("正在检查更新…");
        io.execute(()->{try{AppUpdate.Release found=AppUpdate.check(new store.inspirai.library.core.Credentials(this).server());ui(()->{
            release=found;buttons(false);
            notice(found.newerThan(BuildConfig.VERSION_CODE)?"发现新版本 "+found.version+" · "+String.format(java.util.Locale.CHINA,"%.1f MB",found.size/1048576.0):"当前已是最新版本（"+BuildConfig.VERSION_NAME+"）");
            if(autoDownload&&found.newerThan(BuildConfig.VERSION_CODE))download();
        });}catch(Exception e){ui(()->{buttons(false);fail(e);});}});
    }
    private void download(){
        if(busy||release==null)return;buttons(true);notice("正在下载更新…");progress.setProgress(0);
        io.execute(()->{try{AppUpdate.download(this,release,p->ui(()->{progress.setProgress(p);notice(p<100?"正在下载更新 "+p+"%":"正在校验安装包…");}));ui(()->{buttons(false);requestInstall();});}catch(Exception e){ui(()->{buttons(false);fail(e);});}});
    }
    private void requestInstall(){
        if(!getPackageManager().canRequestPackageInstalls()){
            notice("安装包已准备好，请允许本应用安装更新。");
            roundedDialog(new AlertDialog.Builder(this).setTitle("允许安装更新").setMessage("请在接下来的系统页面开启「允许来自此来源的应用」，返回后继续安装。")
                .setNegativeButton("稍后",null).setPositiveButton("去设置",(d,w)->{try{waitingPermission=true;startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,Uri.parse("package:"+getPackageName())));}catch(Exception e){waitingPermission=false;fail(e);}}).create());
            return;
        }
        buttons(true);
        io.execute(()->{try{AppUpdate.verify(this,release,AppUpdate.file(this,release));ui(()->{
            buttons(false);
            try{Uri uri=FileProvider.getUriForFile(this,getPackageName()+".updates",AppUpdate.file(this,release));
                Intent intent=new Intent(Intent.ACTION_VIEW).setDataAndType(uri,"application/vnd.android.package-archive").addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                startActivity(intent);notice("请在系统页面确认安装。取消后可再次点击安装。");install.setText("再次安装更新");
            }catch(Exception e){fail(e);}
        });}catch(Exception e){ui(()->{buttons(false);fail(e);});}});
    }
    @Override protected void onResume(){super.onResume();if(waitingPermission){waitingPermission=false;if(getPackageManager().canRequestPackageInstalls())requestInstall();else notice("尚未允许安装，可点击更新按钮重试。");}}
    @Override protected void onDestroy(){io.shutdownNow();super.onDestroy();}
}

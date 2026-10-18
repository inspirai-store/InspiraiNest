package store.inspirai.library;

import android.Manifest;
import android.content.*;
import android.content.pm.PackageManager;
import android.graphics.*;
import android.net.Uri;
import android.os.Bundle;
import android.widget.LinearLayout;
import com.google.zxing.*;
import com.google.zxing.common.HybridBinarizer;
import com.journeyapps.barcodescanner.*;
import java.io.InputStream;
import java.util.*;
import store.inspirai.library.core.PairingCode;

public class ScanPairingActivity extends Screen {
    private DecoratedBarcodeView scanner;
    private boolean accepted;
    @Override public void onCreate(Bundle state) {
        super.onCreate(state);page("扫码配对","扫描网页版「授权设备」中的手机配对二维码");
        scanner=new DecoratedBarcodeView(this);
        scanner.setStatusText("将配对二维码放入框内");
        scanner.getBarcodeView().setDecoderFactory(new DefaultDecoderFactory(Collections.singletonList(BarcodeFormat.QR_CODE)));
        body.addView(scanner,new LinearLayout.LayoutParams(-1,dp(290)));
        scanner.getBarcodeView().addStateListener(new CameraPreview.StateListener(){
            public void previewSized(){} public void previewStarted(){notice("相机已开启，对准二维码即可识别。");} public void previewStopped(){} public void cameraClosed(){}
            public void cameraError(Exception e){notice("相机暂不可用，可以从相册识别二维码。");}
        });
        button(body,"从相册识别二维码",()->startActivityForResult(new Intent(Intent.ACTION_OPEN_DOCUMENT).setType("image/*").addCategory(Intent.CATEGORY_OPENABLE),42));
        button(body,"开启相机扫描",this::requestCamera);
        button(body,"返回手动配对",this::finish);
        if(state==null)requestCamera();
    }
    private void requestCamera(){
        if(checkSelfPermission(Manifest.permission.CAMERA)==PackageManager.PERMISSION_GRANTED)startCamera();
        else requestPermissions(new String[]{Manifest.permission.CAMERA},41);
    }
    private void startCamera(){if(scanner!=null&&!accepted){scanner.resume();scanner.decodeSingle(new BarcodeCallback(){public void barcodeResult(BarcodeResult result){accept(result.getText());}});}}
    private void accept(String text){
        if(accepted)return;
        try{PairingCode.parse(text);accepted=true;scanner.pause();setResult(RESULT_OK,new Intent().putExtra("pairingCode",text));finish();}
        catch(Exception e){notice(e.getMessage());scanner.pause();}
    }
    @Override public void onRequestPermissionsResult(int request,String[] permissions,int[] results){super.onRequestPermissionsResult(request,permissions,results);if(request==41){if(results.length>0&&results[0]==PackageManager.PERMISSION_GRANTED)startCamera();else notice("未开启相机权限，仍可从相册识别或返回手动配对。");}}
    @Override protected void onResume(){super.onResume();if(checkSelfPermission(Manifest.permission.CAMERA)==PackageManager.PERMISSION_GRANTED)startCamera();}
    @Override protected void onPause(){if(scanner!=null)scanner.pause();super.onPause();}
    @Override protected void onActivityResult(int request,int result,Intent data){super.onActivityResult(request,result,data);if(request==42&&result==RESULT_OK&&data!=null&&data.getData()!=null){Uri image=data.getData();notice("正在识别二维码…");work(()->readImage(image),this::accept);}}
    private String readImage(Uri image)throws Exception{
        BitmapFactory.Options options=new BitmapFactory.Options();options.inJustDecodeBounds=true;
        try(InputStream in=getContentResolver().openInputStream(image)){BitmapFactory.decodeStream(in,null,options);}
        if(options.outWidth<=0||options.outHeight<=0)throw new Exception("无法读取图片，请选择清晰的二维码图片。");
        options.inSampleSize=1;while(Math.max(options.outWidth,options.outHeight)/options.inSampleSize>2048)options.inSampleSize*=2;
        options.inJustDecodeBounds=false;
        Bitmap bitmap;try(InputStream in=getContentResolver().openInputStream(image)){bitmap=BitmapFactory.decodeStream(in,null,options);}
        if(bitmap==null)throw new Exception("无法读取图片，请重新选择。");
        try{
            int w=bitmap.getWidth(),h=bitmap.getHeight();int[] pixels=new int[w*h];bitmap.getPixels(pixels,0,w,0,0,w,h);
            Map<DecodeHintType,Object> hints=new EnumMap<>(DecodeHintType.class);hints.put(DecodeHintType.POSSIBLE_FORMATS,Collections.singletonList(BarcodeFormat.QR_CODE));hints.put(DecodeHintType.TRY_HARDER,true);
            return new MultiFormatReader().decode(new BinaryBitmap(new HybridBinarizer(new RGBLuminanceSource(w,h,pixels))),hints).getText();
        }catch(NotFoundException e){throw new Exception("没有识别到二维码，请使用完整、清晰的二维码图片。");}
        finally{bitmap.recycle();}
    }
}

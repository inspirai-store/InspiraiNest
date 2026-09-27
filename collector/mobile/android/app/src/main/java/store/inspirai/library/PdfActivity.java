package store.inspirai.library;

import android.os.Bundle;
import android.os.ParcelFileDescriptor;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.graphics.pdf.PdfRenderer;
import android.util.Base64;
import android.widget.*;
import org.json.*;
import java.io.*;
import store.inspirai.library.core.*;

/** Native paged PDF preview. The private temporary file is unlinked once opened. */
public class PdfActivity extends Screen {
    private PdfRenderer renderer;
    private ImageView image;
    private Button previous,next,save;
    private byte[] pdfBytes;
    private int pageNumber;
    private boolean loading;
    @Override public void onCreate(Bundle state){
        super.onCreate(state);page("PDF 阅读",getIntent().getStringExtra("file"));
        if(state!=null)pageNumber=state.getInt("page");
        LinearLayout controls=new LinearLayout(this);body.addView(controls);
        previous=button(controls,"上一页",()->renderPage(pageNumber-1));next=button(controls,"下一页",()->renderPage(pageNumber+1));previous.setEnabled(false);next.setEnabled(false);previous.setLayoutParams(new LinearLayout.LayoutParams(0,-2,1));next.setLayoutParams(new LinearLayout.LayoutParams(0,-2,1));
        save=button(body,"保存 PDF",()->startActivityForResult(new android.content.Intent(android.content.Intent.ACTION_CREATE_DOCUMENT).setType("application/pdf").addCategory(android.content.Intent.CATEGORY_OPENABLE).putExtra(android.content.Intent.EXTRA_TITLE,new File(getIntent().getStringExtra("file")).getName()),84));save.setEnabled(false);
        image=new ImageView(this);image.setAdjustViewBounds(true);image.setContentDescription("PDF 当前页面");body.addView(image,new LinearLayout.LayoutParams(-1,-2));
        String route=getIntent().getStringExtra("route"),file=getIntent().getStringExtra("file");
        if(route==null||file==null||!route.matches("/api/(archives/[a-f0-9]{64}|tasks/[^/]+/draft)")){notice("无效附件地址");return;}
        notice("正在读取私有 PDF…");
        work(()->{
            JSONArray files=new Api(new Credentials(this)).call(route,"GET",null).getJSONArray("files");byte[] bytes=null;
            for(int i=0;i<files.length();i++){JSONObject f=files.getJSONObject(i);if(file.equals(f.getString("path")))bytes=Base64.decode(f.getString("body"),Base64.DEFAULT);}
            if(bytes==null)throw new IOException("附件已不可用");pdfBytes=bytes;
            File temp=File.createTempFile("library-pdf-",".pdf",getCacheDir());
            ParcelFileDescriptor descriptor=null;
            try{try(FileOutputStream out=new FileOutputStream(temp)){out.write(bytes);}descriptor=ParcelFileDescriptor.open(temp,ParcelFileDescriptor.MODE_READ_ONLY);renderer=new PdfRenderer(descriptor);descriptor=null;return renderer.getPageCount();}
            finally{if(descriptor!=null)descriptor.close();temp.delete();}
        },count->{save.setEnabled(true);renderPage(Math.max(0,Math.min(pageNumber,count-1)));});
    }
    @Override protected void onActivityResult(int request,int result,android.content.Intent data){super.onActivityResult(request,result,data);if(request==84&&result==RESULT_OK&&data!=null&&pdfBytes!=null){byte[] bytes=pdfBytes;work(()->{try(OutputStream out=getContentResolver().openOutputStream(data.getData(),"w")){if(out==null)throw new IOException("无法保存 PDF");out.write(bytes);}return true;},v->notice("PDF 已保存"));}}
    private void renderPage(int number){if(loading||renderer==null||number<0||number>=renderer.getPageCount())return;loading=true;previous.setEnabled(false);next.setEnabled(false);
        work(()->{try(PdfRenderer.Page page=renderer.openPage(number)){double scale=Math.min(1600.0/page.getWidth(),2200.0/page.getHeight());Bitmap bitmap=Bitmap.createBitmap(Math.max(1,(int)(page.getWidth()*scale)),Math.max(1,(int)(page.getHeight()*scale)),Bitmap.Config.ARGB_8888);bitmap.eraseColor(Color.WHITE);page.render(bitmap,null,null,PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY);return bitmap;}},bitmap->{image.setImageBitmap(bitmap);pageNumber=number;loading=false;previous.setEnabled(number>0);next.setEnabled(number+1<renderer.getPageCount());notice("第 "+(number+1)+" / "+renderer.getPageCount()+" 页");});
    }
    @Override protected void onSaveInstanceState(Bundle state){state.putInt("page",pageNumber);super.onSaveInstanceState(state);}
    @Override protected void onDestroy(){io.execute(()->{if(renderer!=null){renderer.close();renderer=null;}});super.onDestroy();}
}

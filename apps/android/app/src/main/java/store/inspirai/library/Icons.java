package store.inspirai.library;
import android.content.Context;
import android.graphics.*;
import android.graphics.drawable.Drawable;
public final class Icons {
 public static Drawable drawable(Context context,String name,int color){
  int resource=switch(name){case "library"->R.drawable.ic_brand_library;case "collect"->R.drawable.ic_brand_collect;case "person"->R.drawable.ic_brand_person;case "bookmark"->R.drawable.ic_brand_bookmark;case "scan"->R.drawable.ic_brand_scan;case "update"->R.drawable.ic_brand_update;default->0;};
  if(resource!=0)return artwork(context,resource,color==Appearance.accent(context));
  return new Drawable(){
  final Paint p=new Paint(3);final int size=Math.round(22*context.getResources().getDisplayMetrics().density);
  public int getIntrinsicWidth(){return size;}public int getIntrinsicHeight(){return size;}
  public void draw(Canvas c){c.save();c.translate(getBounds().left,getBounds().top);c.scale(getBounds().width()/24f,getBounds().height()/24f);p.setColor(color);p.setStrokeWidth(1.6f);p.setStyle(Paint.Style.STROKE);p.setStrokeCap(Paint.Cap.ROUND);p.setStrokeJoin(Paint.Join.ROUND);Path a=new Path();
   switch(name){case "library":c.drawRoundRect(4,3,19,21,2,2,p);c.drawLine(8,3,8,21,p);c.drawLine(12,8,16,8,p);break;case "collect":c.drawRoundRect(4,5,20,21,2,2,p);c.drawLine(8,3,16,3,p);c.drawLine(8,10,16,10,p);c.drawLine(8,15,13,15,p);break;case "person":c.drawCircle(12,7,3.5f,p);c.drawArc(4,13,20,27,180,180,false,p);break;case "plus":c.drawLine(12,5,12,19,p);c.drawLine(5,12,19,12,p);break;default:a.moveTo(14,5);a.lineTo(7,12);a.lineTo(14,19);c.drawPath(a,p);}c.restore();}
  public void setAlpha(int a){p.setAlpha(a);}public void setColorFilter(ColorFilter f){p.setColorFilter(f);}public int getOpacity(){return PixelFormat.TRANSLUCENT;}
 };}
 private static final android.util.SparseArray<Bitmap> bitmaps=new android.util.SparseArray<>();
 private static Drawable artwork(Context context,int resource,boolean selected){
  Bitmap cached=bitmaps.get(resource);if(cached==null){cached=BitmapFactory.decodeResource(context.getResources(),resource);bitmaps.put(resource,cached);}final Bitmap bitmap=cached;
  return new Drawable(){final Paint paint=new Paint(Paint.ANTI_ALIAS_FLAG|Paint.FILTER_BITMAP_FLAG);final int size=Math.round(36*context.getResources().getDisplayMetrics().density);final boolean night=Appearance.dark(context);int alpha=255;
   public int getIntrinsicWidth(){return size;}public int getIntrinsicHeight(){return size;}
   public void draw(Canvas c){Rect b=getBounds();paint.setAlpha(alpha);if(!night&&selected){paint.setColor(Color.parseColor("#E8EEE3"));paint.setAlpha(alpha);c.drawRoundRect(new RectF(b),size*.38f,size*.38f,paint);}paint.setAlpha(selected?alpha:Math.round(alpha*.88f));float pad=size*.04f;c.drawBitmap(bitmap,null,new RectF(b.left+pad,b.top+pad,b.right-pad,b.bottom-pad),paint);}
   public void setAlpha(int value){alpha=value;invalidateSelf();}public void setColorFilter(ColorFilter filter){paint.setColorFilter(filter);invalidateSelf();}public int getOpacity(){return PixelFormat.TRANSLUCENT;}
  };
 }

}

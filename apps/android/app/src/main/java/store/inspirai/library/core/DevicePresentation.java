package store.inspirai.library.core;

import org.json.JSONObject;
import java.time.Instant;
import java.util.Arrays;

public final class DevicePresentation {
    private DevicePresentation() {}
    public static String category(JSONObject d) {
        if (d.has("category")) return d.optString("category");
        String role=d.optString("role"), type=d.optString("clientType");
        JSONObject info=d.optJSONObject("deviceInfo"), client=info==null?null:info.optJSONObject("client");
        if(type.isEmpty()&&client!=null)type=client.optString("type");
        if(role.equals("reader"))return "integration";
        if(role.equals("worker")||Arrays.asList("desktop","worker").contains(type))return "desktop";
        if(Arrays.asList("android","ios").contains(type))return "mobile";
        return type.equals("web")?"browser":"unknown";
    }
    public static boolean dispatchable(JSONObject d) {
        return d.isNull("revokedAt")&&category(d).equals("desktop")&&d.optBoolean("workerAuthorized",d.optString("role").equals("worker"));
    }
    private static boolean expired(JSONObject d,String field) {
        try{return Instant.parse(d.getString(field)).isBefore(Instant.now());}catch(Exception e){return false;}
    }
    public static String status(JSONObject d) {
        if(!d.isNull("revokedAt"))return "已撤销";
        String category=category(d);
        if(category.equals("browser"))return !d.isNull("loggedOutAt")?"已退出":expired(d,"browserExpiresAt")?"已过期":"已登录";
        if(category.equals("integration"))return expired(d,"expiresAt")?"已过期":"只读授权";
        if(category.equals("mobile"))return "已登录";
        if(!category.equals("desktop"))return "待识别";
        if(!dispatchable(d))return "未启用工作节点";
        if(!d.optBoolean("online"))return "工作节点离线";
        if(d.optJSONArray("agents")==null||d.optJSONArray("agents").length()==0)return "无可用 Agent";
        return d.optJSONArray("capabilities")==null||d.optJSONArray("capabilities").length()==0?"未启用处理能力":"工作节点在线";
    }
}

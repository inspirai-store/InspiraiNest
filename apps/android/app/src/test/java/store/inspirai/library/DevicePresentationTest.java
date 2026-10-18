package store.inspirai.library;

import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;
import store.inspirai.library.core.DevicePresentation;
import static org.junit.Assert.*;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 35)
public class DevicePresentationTest {
    @Test public void browserAndMobileNeverBecomeDispatchTargets() throws Exception {
        for(String category:new String[]{"browser","mobile","integration","unknown"}) {
            JSONObject d=new JSONObject().put("category",category).put("role","owner").put("workerAuthorized",true).put("online",true);
            assertFalse(DevicePresentation.dispatchable(d));
            assertFalse(DevicePresentation.status(d).contains("工作节点"));
        }
    }
    @Test public void desktopWithoutAgentIsNotReportedReady() throws Exception {
        JSONObject d=new JSONObject("{\"category\":\"desktop\",\"role\":\"worker\",\"online\":true,\"agents\":[]}");
        assertTrue(DevicePresentation.dispatchable(d));assertEquals("无可用 Agent",DevicePresentation.status(d));
        d.put("online",false);assertEquals("工作节点离线",DevicePresentation.status(d));
        d.put("workerAuthorized",false);assertEquals("未启用工作节点",DevicePresentation.status(d));
    }
}

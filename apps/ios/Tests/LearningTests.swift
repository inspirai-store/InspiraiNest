import XCTest
import SwiftUI
@testable import PersonalLibrary

private final class LearningProtocol:URLProtocol {
    static var handler:((URLRequest)throws->Data)?
    override class func canInit(with request:URLRequest)->Bool{true}
    override class func canonicalRequest(for request:URLRequest)->URLRequest{request}
    override func startLoading(){do{let data=try Self.handler!(request);let response=HTTPURLResponse(url:request.url!,statusCode:200,httpVersion:"HTTP/1.1",headerFields:["Content-Type":"application/json"])!;client?.urlProtocol(self,didReceive:response,cacheStoragePolicy:.notAllowed);client?.urlProtocol(self,didLoad:data);client?.urlProtocolDidFinishLoading(self)}catch{client?.urlProtocol(self,didFailWithError:error)}}
    override func stopLoading(){}
}
final class LearningTests:XCTestCase {
    private func fixture()throws->Data{
        let bundle=Bundle(for:Self.self)
        let url=bundle.url(forResource:"learning-goal",withExtension:"json",subdirectory:"fixtures") ?? bundle.url(forResource:"learning-goal",withExtension:"json")
        return try Data(contentsOf:XCTUnwrap(url))
    }
    private func api()throws->CollectorAPI{let config=URLSessionConfiguration.ephemeral;config.protocolClasses=[LearningProtocol.self];return CollectorAPI(origin:try ServerOrigin("https://learning.invalid"),token:"fixture-learning-token",configuration:config)}
    override func tearDown(){LearningProtocol.handler=nil}
    func testGoalDecodingAndOriginBoundProgressSubmission()async throws{
        let data=try fixture();var saved=false
        LearningProtocol.handler={request in
            XCTAssertEqual(request.url?.host,"learning.invalid");XCTAssertEqual(request.value(forHTTPHeaderField:"Authorization"),"Bearer fixture-learning-token")
            if request.httpMethod=="POST"{XCTAssertTrue(request.url!.path.hasSuffix("/progress"));saved=true;return Data("{}".utf8)}
            return data
        }
        let client=try api(),goal=try await client.learningGoal("11111111-1111-4111-8111-111111111111")
        XCTAssertEqual(goal.nodes.count,15);XCTAssertEqual(goal.nodes.first{$0.id=="kv-cache"}?.mastery,"pending")
        try await client.learningPost("/api/learning/goals/"+goal.id+"/progress",input:["revision":goal.revision,"nodeId":"kv-cache","notes":"已解释 KV 容量"])
        XCTAssertTrue(saved)
        do{_ = try await client.learningArtifact("../outside");XCTFail("invalid artifact accepted")}catch{}
    }
    func testFrozenSourceBodyDecodesAlongsideLegacySources()throws {
        var value=try XCTUnwrap(JSONSerialization.jsonObject(with:fixture()) as? [String:Any])
        value["sources"]=[["kind":"record","sourceId":"jd","version":"1","title":"岗位快照","coverage":"partial","text":"原始 JD 正文与定位"],["kind":"record","sourceId":"legacy","version":"1","title":"旧来源","coverage":"partial"]]
        let goal=try JSONDecoder().decode(LearningGoal.self,from:JSONSerialization.data(withJSONObject:value))
        XCTAssertEqual(goal.sources[0].text,"原始 JD 正文与定位");XCTAssertNil(goal.sources[1].text)
    }
    @MainActor func testProductionLearningViewsRenderOnCurrentDevice()async throws{
        var snapshot=try XCTUnwrap(JSONSerialization.jsonObject(with:fixture()) as? [String:Any])
        snapshot["sources"]=[["kind":"record","sourceId":"jd","version":"1","title":"岗位要求快照","coverage":"partial","text":"原始 JD 与版本定位"],["kind":"record","sourceId":"handbook","version":"1","title":"面试学习手册快照","coverage":"full","text":"面试学习手册原文"]]
        let data=try JSONSerialization.data(withJSONObject:snapshot),goal=try JSONDecoder().decode(LearningGoal.self,from:data)
        let credentials=CredentialStore(),previous=try credentials.load()
        defer{if let previous{try? credentials.save(previous)}else{try? credentials.clear()}}
        try credentials.save(DeviceCredential(origin:"https://learning.invalid",deviceID:"11111111-1111-4111-8111-111111111111",name:"Learning fixture",token:"fixture-learning-token"))
        LearningProtocol.handler={request in
            if request.url!.path=="/api/learning"{return try JSONSerialization.data(withJSONObject:["goals":[JSONSerialization.jsonObject(with:data)],"candidates":[]])}
            if request.url!.path=="/api/learning/sources"{return Data("{\"items\":[]}".utf8)}
            return data
        }
        let model=AppModel(makeAPI:{origin,token in let config=URLSessionConfiguration.ephemeral;config.protocolClasses=[LearningProtocol.self];return CollectorAPI(origin:origin,token:token,configuration:config)})
        let scene=try XCTUnwrap(UIApplication.shared.connectedScenes.compactMap{$0 as? UIWindowScene}.first)
        let window=UIWindow(windowScene:scene);window.frame=scene.screen.bounds
        let views=[("learning-goals",AnyView(NavigationStack{LearningView().environmentObject(model)})),("learning-kv-cache",AnyView(NavigationStack{LearningNodeView(goalID:goal.id,nodeID:"kv-cache").environmentObject(model)}))]
        for (name,view) in views{
            let host=UIHostingController(rootView:view);window.rootViewController=host;window.makeKeyAndVisible()
            try await Task.sleep(nanoseconds:700_000_000);host.view.setNeedsLayout();host.view.layoutIfNeeded()
            func editableTextViews(_ view:UIView)->Int{(view is UITextView && (view as? UITextView)?.isEditable == true ? 1:0)+view.subviews.reduce(0){$0+editableTextViews($1)}}
            XCTAssertEqual(editableTextViews(host.view),0,"Default learning pages must not expose empty text editors")
            let image=UIGraphicsImageRenderer(bounds:window.bounds).image{_ in window.drawHierarchy(in:window.bounds,afterScreenUpdates:true)}
            XCTAssertGreaterThan(image.size.width,300);XCTAssertGreaterThan(image.size.height,600)
            let attachment=XCTAttachment(image:image);attachment.name=name;attachment.lifetime = .keepAlways;add(attachment)
        }
        if UIDevice.current.userInterfaceIdiom == .pad {
            let portrait=scene.screen.bounds
            let landscape=CGRect(x:0,y:0,width:max(portrait.width,portrait.height),height:min(portrait.width,portrait.height))
            for (name,view) in views {
                window.rootViewController=UIHostingController(rootView:view);window.frame=landscape;window.makeKeyAndVisible();window.rootViewController?.view.frame=window.bounds
                try await Task.sleep(nanoseconds:700_000_000)
                let image=UIGraphicsImageRenderer(bounds:window.bounds).image{_ in window.drawHierarchy(in:window.bounds,afterScreenUpdates:true)}
                XCTAssertGreaterThan(image.size.width,image.size.height)
                let attachment=XCTAttachment(image:image);attachment.name=name+"-landscape";attachment.lifetime = .keepAlways;add(attachment)
            }
            window.frame=portrait
        }
        window.isHidden=true
    }
}

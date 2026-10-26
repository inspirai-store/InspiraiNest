import XCTest
@testable import PersonalLibrary

@MainActor final class NativeLoginTransitionTests:XCTestCase {
  func testNativeLoginPreservesMFAAndDoesNotKeepSecretsAfterSuccess() async {
    var calls=0
    let model=NativePairingModel(name:"隔离手机",dependencies:.init(pair:{_,_,_ in XCTFail("Wrong transport")},verify:{server,key,name,otp,recovery in
      calls += 1;XCTAssertEqual(server,"https://fixture.invalid");XCTAssertEqual(key,"fixture-secret")
      if calls==1 {throw CollectorError.login("mfa_required",401)}
      XCTAssertEqual(otp,"123456");XCTAssertNil(recovery)
    }))
    model.server="https://fixture.invalid";model.key="fixture-secret";await model.submitManual()
    XCTAssertTrue(model.challenge);XCTAssertTrue(model.key.isEmpty);XCTAssertFalse(model.completed)
    model.factor="123456";await model.submitManual()
    XCTAssertTrue(model.completed);XCTAssertFalse(model.challenge);XCTAssertTrue(model.factor.isEmpty)
  }
  func testLeavingLoginRejectsALateSuccessfulResponse() async {
    var pending:CheckedContinuation<Void,Never>?,cancelled=false
    let model=NativePairingModel(name:"隔离手机",dependencies:.init(pair:{_,_,_ in await withCheckedContinuation {pending=$0}},cancel:{cancelled=true}))
    model.key="fixture-secret";let task=Task {await model.submitManual()}
    while pending==nil {await Task.yield()}
    model.clearTransient();pending?.resume();await task.value
    XCTAssertTrue(cancelled);XCTAssertFalse(model.completed);XCTAssertFalse(model.busy);XCTAssertTrue(model.key.isEmpty)
  }
}

import XCTest
@testable import PersonalLibrary
final class PluginCatalogTests: XCTestCase {
 func testSharedPluginContract() throws {
  let file=try XCTUnwrap(Bundle(for:Self.self).url(forResource:"plugins",withExtension:"json",subdirectory:"fixtures"))
  let snapshot=try JSONDecoder().decode(ProductPluginSnapshot.self,from:Data(contentsOf:file))
  XCTAssertEqual(snapshot.protocolVersion,1);XCTAssertTrue(snapshot.supports("ai-assistant"));XCTAssertFalse(snapshot.supports("writing"))
  XCTAssertEqual(snapshot.plugins.first { $0.id == "writing" }?.dependencies,["ai-assistant"])
 }
}

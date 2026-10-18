package store.inspirai.library.nativeui

import androidx.room.Room
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.*
import org.json.*
import org.junit.*
import org.junit.Assert.*
import org.junit.runner.RunWith
import org.robolectric.*
import org.robolectric.annotation.*
import store.inspirai.library.core.Credentials
import store.inspirai.library.nativeui.data.*
import java.io.IOException
import java.util.UUID

@RunWith(RobolectricTestRunner::class)
@Config(sdk=[35],shadows=[BoundRecordCredentials::class],instrumentedPackages=["store.inspirai.library.core"])
class NativeSyncTest {
    private lateinit var database: NativeDatabase
    @Before fun open(){BoundRecordCredentials.generation="same-generation";database=Room.inMemoryDatabaseBuilder(RuntimeEnvironment.getApplication(),NativeDatabase::class.java).build()}
    @After fun close(){database.close()}
    @Test fun acknowledgementLossReplaysTheExactRequestBeforeSendingTheNextEdit()=runBlocking {
        val requests=mutableListOf<JSONObject>();var lost=true;var version=7L
        val repository=AndroidNestRepository(RuntimeEnvironment.getApplication(),database) { path,method,body->
            if(method=="PUT") {
                requests+=body!!.copyJson()
                if(lost){lost=false;throw IOException("confirmation lost")}
                version++;JSONObject().put("record",JSONObject().put("id",path.substringAfterLast('/')).put("version",version))
            }else JSONObject().put("records",JSONArray()).put("deleted",JSONArray())
        }
        val dao=database.dao();dao.journal(MigrationLog("records-v1","complete"));val id=UUID.randomUUID().toString()
        repository.saveRecord(JSONObject().put("id",id).put("server","https://records.example").put("text","第一次正文").put("createdAt","2026-10-17T01:00:00Z").put("remoteVersion",7),false)
        repository.syncRecords()
        val frozen=JSONObject(dao.record("https://records.example",id)!!.json).getJSONObject("payload").toString()
        repository.saveRecord(JSONObject().put("id",id).put("server","https://records.example").put("text","随后编辑").put("createdAt","2026-10-17T01:00:00Z"),false)
        assertEquals(frozen,JSONObject(dao.record("https://records.example",id)!!.json).getJSONObject("payload").toString())
        repository.syncRecords();assertEquals(requests[0].toString(),requests[1].toString());assertEquals("第一次正文",requests[1].getString("text"))
        assertEquals("pending",JSONObject(dao.record("https://records.example",id)!!.json).getString("sync"))
        repository.syncRecords();assertEquals("随后编辑",requests[2].getString("text"));assertEquals(8,requests[2].getInt("baseVersion"));assertNotEquals(requests[1].getString("requestId"),requests[2].getString("requestId"))
        assertEquals("synced",JSONObject(dao.record("https://records.example",id)!!.json).getString("sync"))
    }
    @Test fun migrationGatePreventsOldAndNewDrainersFromRunningTogether()=runBlocking {
        var calls=0;val repository=AndroidNestRepository(RuntimeEnvironment.getApplication(),database){ _,_,_->calls++;JSONObject() }
        repository.syncRecords();assertEquals(0,calls)
    }
    @Test fun processingConfirmationLossKeepsItsRequestAndDoesNotChangeSyncStatus()=runBlocking {
        val id=UUID.randomUUID().toString();val taskId=UUID.randomUUID().toString();val attempts=mutableListOf<String>();var lost=true
        val repository=AndroidNestRepository(RuntimeEnvironment.getApplication(),database){path,method,body->
            if(path.endsWith("/process")) {
                attempts+=body!!.toString();if(lost){lost=false;throw IOException("processing acknowledgement lost")}
                JSONObject().put("id",taskId).put("state","queued").put("recordVersion",7)
            }else JSONObject().put("records",JSONArray())
        }
        val dao=database.dao();dao.journal(MigrationLog("records-v1","complete"))
        dao.put(LocalRecord("https://records.example",id,JSONObject().put("id",id).put("text","原记录").put("remoteVersion",7).put("sync","synced").put("createdAt","2026-10-17T01:00:00Z").toString(),0))
        repository.processRecord("https://records.example",id,"summary","保留来源")
        repository.syncRecords();val waiting=JSONObject(dao.record("https://records.example",id)!!.json)
        assertEquals("synced",waiting.getString("sync"));assertTrue(waiting.has("pendingProcess"));assertTrue(waiting.has("processError"))
        repository.syncRecords();assertEquals(attempts[0],attempts[1]);val accepted=JSONObject(dao.record("https://records.example",id)!!.json)
        assertEquals("synced",accepted.getString("sync"));assertFalse(accepted.has("pendingProcess"));assertFalse(accepted.has("processError"));assertEquals(taskId,accepted.getJSONArray("tasks").getJSONObject(0).getString("id"))
    }
    @Test fun savingLocallyDoesNotWaitForNetworkAndTheNewEditSurvivesAcknowledgement()=runBlocking {
        val entered=CompletableDeferred<Unit>();val release=CompletableDeferred<Unit>();val id=UUID.randomUUID().toString()
        val repository=AndroidNestRepository(RuntimeEnvironment.getApplication(),database){path,method,body->
            if(method=="PUT"){entered.complete(Unit);release.await();JSONObject().put("id",id).put("version",1)}else JSONObject().put("records",JSONArray())
        }
        database.dao().journal(MigrationLog("records-v1","complete"))
        val original=JSONObject().put("id",id).put("server","https://records.example").put("text","第一次正文").put("createdAt","2026-10-17T01:00:00Z")
        repository.saveRecord(original,false)
        val network=launch { repository.syncRecords() };withTimeout(5000){entered.await()}
        try { withTimeout(2000){repository.saveRecord(original.copyJson().put("text","网络等待期间的编辑"),false)} }finally {release.complete(Unit)}
        network.join();val saved=JSONObject(database.dao().record("https://records.example",id)!!.json)
        assertEquals("网络等待期间的编辑",saved.getString("text"));assertEquals("pending",saved.getString("sync"));assertEquals(1,saved.getInt("remoteVersion"))
    }
    @Test fun remoteDeletionProtectsBothPendingAndEditingVersionsAndExplicitRestoreDoesNotReplayThem()=runBlocking {
        val id=UUID.randomUUID().toString();val server="https://records.example"
        var response=JSONObject().put("cursor","epoch:1").put("records",JSONArray()).put("deleted",JSONArray().put(JSONObject().put("id",id).put("version",1).put("trashVersion",1).put("deletedAt","2026-10-17T02:00:00Z")))
        val repository=AndroidNestRepository(RuntimeEnvironment.getApplication(),database){path,_,_->if(path.endsWith("capabilities"))JSONObject().put("recordSyncProtocol",1) else response}
        val raw=JSONObject().put("recoveryDrafts",JSONArray().put(JSONObject().put("text","上次删除时保留的修改").put("attachments",JSONArray()).put("recoveryKind","editor").put("recoveryTrashVersion",-1))).put("id",id).put("text","尚未上传").put("attachments",JSONArray()).put("remoteVersion",1).put("sync","failed").put("createdAt","2026-10-17T01:00:00Z").put("payload",JSONObject().put("requestId","stable-original")).put("editingDraft",JSONObject().put("id",id).put("text","编辑中的文字").put("attachments",JSONArray()))
        database.dao().put(LocalRecord(server,id,raw.toString(),1));val client=RecordSyncClient(database,repository);client.pull()
        var saved=JSONObject(database.dao().record(server,id)!!.json)
        assertEquals(3,saved.getJSONArray("recoveryDrafts").length());client.pull();assertEquals(3,JSONObject(database.dao().record(server,id)!!.json).getJSONArray("recoveryDrafts").length());assertEquals("stable-original",saved.getJSONObject("cancelledPayload").getString("requestId"));assertFalse(saved.has("payload"));assertEquals("synced",saved.getString("sync"))
        repository.saveRecord(raw.getJSONObject("editingDraft"),true);assertEquals(3,JSONObject(database.dao().record(server,id)!!.json).getJSONArray("recoveryDrafts").length())
        val active=JSONObject().put("id",id).put("text","远端正文").put("attachments",JSONArray()).put("version",100).put("trashVersion",0).put("deletedAt",JSONObject.NULL)
        response=JSONObject().put("cursor","epoch:2").put("records",JSONArray().put(active));client.pull();assertFalse(JSONObject(database.dao().record(server,id)!!.json).isNull("deletedAt"))
        active.put("version",1).put("trashVersion",2);response=JSONObject().put("cursor","epoch:3").put("records",JSONArray().put(active));client.pull();saved=JSONObject(database.dao().record(server,id)!!.json)
        assertTrue(saved.isNull("deletedAt"));assertEquals("远端正文",saved.getString("text"));assertEquals(3,saved.getJSONArray("recoveryDrafts").length());assertFalse(saved.has("payload"))
        val copy=repository.saveRecoveryAsNew(raw.getJSONObject("editingDraft"));assertNotEquals(id,copy);assertEquals("pending",JSONObject(database.dao().record(server,copy)!!.json).getString("sync"));assertEquals(2,JSONObject(database.dao().record(server,id)!!.json).getJSONArray("recoveryDrafts").length())
    }
    @Test fun cursorAndAllRowsRollbackTogetherAndDuplicatePageIsSafe()=runBlocking {
        val id=UUID.randomUUID().toString();val server="https://records.example"
        var response=JSONObject().put("cursor","epoch:1").put("records",JSONArray().put(JSONObject().put("id",id).put("text","第一条").put("version",1).put("attachments",JSONArray())).put(JSONObject().put("text","无效的第二条")))
        val repository=AndroidNestRepository(RuntimeEnvironment.getApplication(),database){path,_,_->if(path.endsWith("capabilities"))JSONObject().put("recordSyncProtocol",1) else response}
        val client=RecordSyncClient(database,repository)
        try {client.pull();fail("invalid page must roll back")}catch(e: JSONException){}
        assertNull(database.dao().record(server,id));assertTrue(database.dao().journals("record-sync:%").isEmpty())
        response.getJSONArray("records").remove(1);client.pull();client.pull()
        assertEquals(1,database.dao().records().size);assertEquals("epoch:1",JSONObject(database.dao().journals("record-sync:%").single().json).getString("cursor"))
        response=JSONObject().put("cursor","epoch:0").put("records",JSONArray().put(JSONObject().put("id",id).put("text","旧响应").put("version",1).put("attachments",JSONArray())))
        client.pull();assertEquals("第一条",JSONObject(database.dao().record(server,id)!!.json).getString("text"))
    }
    @Test fun deleteAndRestoreConfirmationLossReuseDurableRequestAfterWorkerRestart()=runBlocking {
        val id=UUID.randomUUID().toString();val server="https://records.example";var lost=true;var deleted=false;var trash=0;val requests=mutableListOf<String>()
        val handler:suspend(String,String,JSONObject?)->JSONObject={path,method,body->
            when {
                path.endsWith("capabilities")->JSONObject().put("recordSyncProtocol",1)
                method=="POST"->{requests+=body!!.toString();if(lost){lost=false;throw IOException("confirmation lost")};deleted=path.endsWith("delete");trash++;JSONObject().put("deletedAt",if(deleted)"2026-10-17T02:00:00Z" else JSONObject.NULL).put("trashVersion",trash)}
                else->JSONObject().put("cursor","epoch:$trash").put("records",JSONArray().put(JSONObject().put("id",id).put("text","原正文").put("version",1).put("attachments",JSONArray()).put("trashVersion",trash).put("deletedAt",if(deleted)"2026-10-17T02:00:00Z" else JSONObject.NULL)))
            }
        }
        var repository=AndroidNestRepository(RuntimeEnvironment.getApplication(),database,handler);val dao=database.dao();dao.journal(MigrationLog("records-v1","complete"));dao.put(LocalRecord(server,id,JSONObject().put("id",id).put("text","原正文").put("remoteVersion",1).put("sync","synced").put("attachments",JSONArray()).toString(),1))
        repository.setRecordDeleted(id,true);assertFalse(JSONObject(dao.record(server,id)!!.json).isNull("deletedAt"))
        try{repository.syncRecords();fail("request should wait for retry")}catch(e: IOException){}
        assertEquals(1,dao.journals("record-operation:%").size)
        repository=AndroidNestRepository(RuntimeEnvironment.getApplication(),database,handler);repository.syncRecords();assertEquals(requests[0],requests[1]);assertTrue(dao.journals("record-operation:%").isEmpty());assertFalse(JSONObject(dao.record(server,id)!!.json).isNull("deletedAt"))
        repository.setRecordDeleted(id,false);repository.syncRecords();assertTrue(JSONObject(dao.record(server,id)!!.json).isNull("deletedAt"));assertEquals(1,dao.records().size);assertEquals(2,JSONObject(dao.record(server,id)!!.json).getInt("trashVersion"))
    }

    @Test fun accountChangeDuringUploadCannotConfirmOldPayloadOrDispatchProcessing()=runBlocking {
        val id=UUID.randomUUID().toString();var processed=0
        val repository=AndroidNestRepository(RuntimeEnvironment.getApplication(),database){path,method,body->
            when {method=="PUT"->{BoundRecordCredentials.generation="another-pairing";JSONObject().put("id",id).put("version",1)}
                path.endsWith("/process")->{processed++;JSONObject()}
                else->JSONObject().put("records",JSONArray())}
        }
        database.dao().journal(MigrationLog("records-v1","complete"))
        repository.saveRecord(JSONObject().put("id",id).put("server","https://records.example").put("text","原账号待上传正文").put("attachments",JSONArray()),false)
        val waiting=database.dao().record("https://records.example",id)!!;database.dao().put(waiting.copy(json=JSONObject(waiting.json).put("pendingProcess",JSONObject().put("requestId","stable-process").put("baseVersion",0).put("preset","summary")).toString()))
        repository.syncRecords();val saved=JSONObject(database.dao().record("https://records.example",id)!!.json)
        assertTrue(saved.has("payload"));assertNotEquals("synced",saved.optString("sync"));assertEquals(0,processed)
    }

    @Test fun sharedCrossPlatformContractSeparatesContentAndLifecycleVersions()=runBlocking {
        val contract=JSONObject(javaClass.classLoader!!.getResourceAsStream("record-sync-v1.json")!!.bufferedReader().use{it.readText()})
        var page=JSONObject();val repository=AndroidNestRepository(RuntimeEnvironment.getApplication(),database){path,_,_->if(path.endsWith("capabilities"))JSONObject().put("recordSyncProtocol",1) else page};val client=RecordSyncClient(database,repository)
        for(case in contract.getJSONArray("cases").objects()){
            val remote=case.getJSONObject("record");val isDeleted=!remote.isNull("deletedAt")
            page=JSONObject().put("records",JSONArray(if(isDeleted)emptyList<JSONObject>() else listOf(remote))).put("deleted",JSONArray(if(isDeleted)listOf(remote) else emptyList<JSONObject>()))
            client.pull();val saved=JSONObject(database.dao().record("https://records.example",remote.getString("id"))!!.json)
            assertEquals(case.getString("name"),case.getBoolean("active"),saved.isNull("deletedAt"))
        }
    }

}
@Implements(value=Credentials::class,isInAndroidSdk=false)
class BoundRecordCredentials {
    companion object { var generation="same-generation" }
    @Implementation fun server()="https://records.example"
    @Implementation fun isPaired()=true
    @Implementation fun snapshot(): Credentials.Snapshot {
        val constructor=Credentials.Snapshot::class.java.getDeclaredConstructor(String::class.java,String::class.java,String::class.java,String::class.java)
        constructor.isAccessible=true
        return constructor.newInstance("https://records.example","fixture-only",UUID(0,0).toString(),generation)
    }
}

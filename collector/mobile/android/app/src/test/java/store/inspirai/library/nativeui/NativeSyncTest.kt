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
    @Before fun open(){database=Room.inMemoryDatabaseBuilder(RuntimeEnvironment.getApplication(),NativeDatabase::class.java).build()}
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
}
@Implements(value=Credentials::class,isInAndroidSdk=false)
class BoundRecordCredentials {
    @Implementation fun server()="https://records.example"
    @Implementation fun isPaired()=true
    @Implementation fun snapshot(): Credentials.Snapshot {
        val constructor=Credentials.Snapshot::class.java.getDeclaredConstructor(String::class.java,String::class.java,String::class.java,String::class.java)
        constructor.isAccessible=true
        return constructor.newInstance("https://records.example","fixture-only",UUID(0,0).toString(),"same-generation")
    }
}

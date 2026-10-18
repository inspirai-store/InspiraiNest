package store.inspirai.library.nativeui.data

import android.content.Context
import androidx.room.*
import kotlinx.coroutines.flow.Flow

/** Raw JSON is retained for forward compatibility and immutable pending request replay. */
@Entity(tableName="records", primaryKeys=["server", "id"])
data class LocalRecord(val server: String, val id: String, val json: String, val updated: Long, val draft: Boolean=false)
@Entity(tableName="migration")
data class MigrationLog(@PrimaryKey val key: String, val json: String)
@Entity(tableName="favorites", primaryKeys=["server", "id"])
data class Favorite(val server: String, val id: String)
@Entity(tableName="record_files", primaryKeys=["server", "recordId", "id"])
data class RecordFile(val recordId: String, val id: String, val json: String, val server: String)

@Dao interface NativeDao {
    @Query("SELECT * FROM records ORDER BY updated DESC") fun observeRecords(): Flow<List<LocalRecord>>
    @Query("SELECT * FROM records") suspend fun records(): List<LocalRecord>
    @Query("SELECT * FROM records WHERE server=:server AND id=:id") suspend fun record(server: String,id: String): LocalRecord?
    @Insert(onConflict=OnConflictStrategy.REPLACE) suspend fun put(record: LocalRecord)
    @Query("DELETE FROM records WHERE server=:server AND id=:id") suspend fun delete(server: String,id: String)
    @Insert(onConflict=OnConflictStrategy.REPLACE) suspend fun journal(log: MigrationLog)
    @Query("SELECT * FROM migration WHERE `key`=:key") suspend fun journal(key: String): MigrationLog?
    @Query("SELECT * FROM migration WHERE `key`=:key") fun observeJournal(key: String): Flow<MigrationLog?>
    @Query("SELECT * FROM migration WHERE `key` LIKE :prefix") suspend fun journals(prefix: String): List<MigrationLog>
    @Query("DELETE FROM migration WHERE `key`=:key") suspend fun removeJournal(key: String)
    @Insert(onConflict=OnConflictStrategy.IGNORE) suspend fun favorite(item: Favorite)
    @Query("DELETE FROM favorites WHERE server=:server AND id=:id") suspend fun unfavorite(server: String,id: String)
    @Query("SELECT id FROM favorites WHERE server=:server") fun favorites(server: String): Flow<List<String>>
    @Insert(onConflict=OnConflictStrategy.REPLACE) suspend fun file(item: RecordFile)
    @Query("SELECT * FROM record_files WHERE recordId=:record AND server=:server") suspend fun files(record: String,server: String): List<RecordFile>
}
@Database(entities=[LocalRecord::class, MigrationLog::class, Favorite::class, RecordFile::class], version=1, exportSchema=true)
abstract class NativeDatabase: RoomDatabase() {
    abstract fun dao(): NativeDao
    companion object {
        @Volatile private var instance: NativeDatabase?=null
        fun open(context: Context): NativeDatabase = instance ?: synchronized(this) {
            instance ?: Room.databaseBuilder(context.applicationContext, NativeDatabase::class.java,
                java.io.File(context.noBackupFilesDir,"native-records.sqlite").absolutePath).build().also { instance=it }
        }
    }
}

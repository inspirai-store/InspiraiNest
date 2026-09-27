package store.inspirai.library.core;

import android.app.job.JobInfo;
import android.app.job.JobParameters;
import android.app.job.JobScheduler;
import android.app.job.JobService;
import android.content.ComponentName;
import android.content.Context;
import android.os.Handler;
import android.os.Looper;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;

/**
 * Manifest integration: INTERNET and RECEIVE_BOOT_COMPLETED permissions, plus this service with
 * android:permission="android.permission.BIND_JOB_SERVICE" and android:exported="false".
 * Keep this service in the app's default process so foreground/background flush share their lock.
 */
public final class QueueJob extends JobService {
    private static final int JOB_ID = 0x4c494252;
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final Handler main = new Handler(Looper.getMainLooper());
    private Run active;

    public static void schedule(Context context) {
        JobScheduler scheduler = context.getSystemService(JobScheduler.class);
        JobInfo info = new JobInfo.Builder(JOB_ID, new ComponentName(context, QueueJob.class))
                .setPersisted(true)
                .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
                .setBackoffCriteria(30000, JobInfo.BACKOFF_POLICY_EXPONENTIAL)
                .build();
        if (scheduler == null || scheduler.schedule(info) != JobScheduler.RESULT_SUCCESS) {
            throw new IllegalStateException("无法安排后台提交，请打开应用后重试。资料已保留。");
        }
    }

    @Override public boolean onStartJob(JobParameters params) {
        if (active != null) active.cancel();
        Run run = new Run(params);
        active = run;
        run.future = executor.submit(() -> {
            boolean reschedule = Outbox.flush(getApplicationContext());
            main.post(() -> {
                if (active == run && !run.stopped) {
                    active = null;
                    jobFinished(params, reschedule);
                }
            });
        });
        return true;
    }

    @Override public boolean onStopJob(JobParameters params) {
        // Stop parameters arrive through Binder and need not be the same Java object as start.
        if (active != null && active.params.getJobId() == params.getJobId()) {
            active.cancel();
            active = null;
        }
        // Interrupting I/O may lose an acknowledgement. The durable ID makes replay safe.
        return true;
    }

    @Override public void onDestroy() {
        if (active != null) active.cancel();
        active = null;
        executor.shutdownNow();
        super.onDestroy();
    }

    private static final class Run {
        final JobParameters params;
        volatile boolean stopped;
        Future<?> future;
        Run(JobParameters params) { this.params = params; }
        void cancel() {
            stopped = true;
            if (future != null) future.cancel(true);
        }
    }
}

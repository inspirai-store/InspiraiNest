# 采集与写作任务诊断

```sh
lingnest auth status --scope diagnostics:read --json
lingnest auth login --scope diagnostics:read
lingnest tasks list --state waiting_action --json
lingnest tasks show TASK_ID --json
lingnest tasks diagnose TASK_ID --json
lingnest tasks events TASK_ID --attempt ATTEMPT_ID --limit 50 --json
lingnest tasks evidence TASK_ID --id EVIDENCE_ID --json
```

仅在诊断未授权、过期或被撤销时，由用户在浏览器确认诊断读取授权。资料授权独立保留，不要求退出原资料登录。系统安全存储不可用时停止，不复制凭据或使用明文后备。

`diagnose` 返回任务现状、按客户端分开的 attempts、执行事件、诊断结论和完整性信息。`routing_evaluations` 是当时保存的派发判断；`current_routing_evaluation` 是当前环境检查，不能据此断言旧任务当时的环境。未获派发不代表执行失败。

按问题读取指定执行次数；`events` 返回 `next_cursor` 时带 `--cursor` 继续。不要只根据列表或最后一条错误推断根因。证据的 reportedBy 为 worker/server/agent/legacy，分别表示程序记录、服务记录、Agent 上报和旧历史。保留这种来源区别；分析推断明确标注。

回答包括：当前停在哪一步；哪台设备、哪次执行、什么版本受阻；支持结论的事件/证据；已保留和缺失的成果；原任务可采取的下一步。没有证据时说明待确认，并指出需要补齐什么。正常等待作者回答、待审稿、用户接管和取消分别表达，不统一报告系统失败。

`completeness` 为旧历史、待同步或截断时，说明范围。执行设备离线时只能分析已同步记录，不能宣称读取了本机完整原始日志。远端证据片段不代表全文或完整 stdout。

诊断仅只读。不自动重试、安装依赖、改权限、控制页面或迁移任务。用户决定继续后，应通过灵藏原有任务入口处理并沿用 taskId；此 Skill 不改管理接口权限。

## 文稿创作
新版文稿的一轮创作使用 turnId 作为 taskId。可从文稿的“执行记录”复制，或用 tasks list 查找 kind=writing 且带 session_id 的条目。重领、重启和换机的执行档案追加保留；旧轮次只提供可靠历史，历史不完整不能推断没有失败。诊断接口不返回创作需求、回复、引用正文和文稿正文。

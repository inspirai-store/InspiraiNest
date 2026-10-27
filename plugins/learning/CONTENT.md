# 内置课程维护记录

版本：`systems-2026-10-27`。正文位于 `protocol/lessons.mjs`，沿用 7 阶段、15 节点。此文件是开发核验记录，不进入学习页面。

本版逐节提供原理、推导或算例、动手步骤与边界。数字均为标明假设的教学算例，不是用户项目经历或设备性能承诺。纯 Python 片段只使用标准库；设备实验由用户在自己的环境中主动执行。前沿节讲阅读和验证方法，不把固定正文冒充实时动态。

2026-10-27 核对的一手资料：

- [Attention 论文](https://arxiv.org/abs/1706.03762)、[PyTorch SDPA](https://docs.pytorch.org/docs/2.14/generated/torch.nn.functional.scaled_dot_product_attention.html)：注意力数据流、缩放、因果约束。
- [GQA 论文](https://arxiv.org/abs/2305.13245)：Query 与 KV 头的关系。
- [FlashAttention 论文](https://arxiv.org/abs/2205.14135)：分块 IO 与稠密计算的区别。
- [vLLM 分页 KV](https://docs.vllm.ai/en/latest/design/paged_attention/)、[PD 分离](https://docs.vllm.ai/en/latest/features/disagg_prefill/)：缓存映射与传输边界。
- [CUDA Programming Guide](https://docs.nvidia.com/cuda/cuda-programming-guide/)、[Triton 归一化教程](https://triton-lang.org/main/getting-started/tutorials/05-layer-norm.html)、[TileLang 官方项目](https://github.com/tile-ai/tilelang)：存储与内核编程方式。CUDA 旧 `cuda-c-programming-guide` 已标为 legacy，本版核对的是新入口。
- [NCCL 集合语义](https://docs.nvidia.com/deeplearning/nccl/user-guide/docs/usage/collectives.html)、[Stream 语义](https://docs.nvidia.com/deeplearning/nccl/user-guide/docs/usage/streams.html)：数据归属与异步依赖。
- [VeRL HybridFlow](https://verl.readthedocs.io/en/latest/hybrid_flow.html)、[vLLM Ascend](https://docs.vllm.ai/projects/ascend/en/latest/)：后训练数据流与硬件插件边界。

原始岗位与手册快照继续由资料空间持有，不打包到公共源码，也不在节点正文和候选卡片中陈列。课程升级仅匹配原内置概述的精确文本；用户已经修改的正文保留。旧正文进入内部修订记录，节点 ID、先修关系、资料、笔记、练习与状态不变，迟到 AI 结果按现有版本冲突逻辑处理。

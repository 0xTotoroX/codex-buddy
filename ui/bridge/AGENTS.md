# ui/bridge/ — 宿主桥接

> L2 | 父级：[AGENTS.md](../../AGENTS.md)

requests 请求桥供共享胶囊调用后台白名单操作；不再独立识别宿主 DOM，也不暴露通用执行接口。

成员清单：

- [requests.js](requests.js)：共享胶囊与 src/requests.rs 的异步请求边界；window.__companionDesktopRequest 请求及完成、销毁回调。

[PROTOCOL]: 变更时更新本文，然后检查父级 AGENTS.md。

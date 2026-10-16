// 单进程测试聚合入口：沙箱环境不允许 node --test 派生子进程，
// 这里直接 import 各测试模块，node:test 会在进程退出前自动执行。
import './seed.test.ts'
import './kimi.test.ts'

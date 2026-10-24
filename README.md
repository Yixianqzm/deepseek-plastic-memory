# 可塑性记忆

给 DSH 用的小记忆仓库。分文件夹记事，久了会淡忘。

## 干嘛的

跟 AI 聊久了它记不住你。全塞进上下文又太贵。

所以我把它拆开：主人、约定、续缘、喜好、时间线，一块一个文件夹。想翻哪块翻哪块，剩下的不碰。碰到新话题（工作、家人、宠物）就再开一块，最多 15 块。

记的时候一条不超过 30 字，能三个字说完就别写一句话。

翻开的时候先看一眼索引，就一行，`M主人:3 P约定:1 ...`，看上哪块再打开。

## 装

```bash
node memtree.mjs init      # 建目录
node memtree.mjs idx       # 看索引
node memtree.mjs add M 爱吃辣
node memtree.mjs open M
```

当 DSH 插件装：

```bash
dsh plugin add deepseek-plastic-memory
```

装完设置里会多一页「可塑性记忆」，左边分区右边条目，能直接翻。会话顶栏也多了个 🧠，点开就是同一个面板。

不想装也行，把它当普通 node 脚本用，命令跟上面一样。

## 命令

| 敲这个 | 干这个 |
| --- | --- |
| `idx` | 一行索引，哪个分区多少条 |
| `open <K>` | 翻开某个分区 |
| `add <K> <文本>` | 记一条，≤30 字，`*` 开头算重要 |
| `done <K> <id>` | 约定办完了，标个 ✓ |
| `rm <K> <id>` | 删掉，进回收站（主人和约定删不了） |
| `mk <名字>` | 开个新分区，最多 15 个 |
| `gc` | 跑一遍遗忘曲线 |
| `init` | 建目录 |

`<K>` 是分区代号：`M` 主人、`P` 约定、`C` 续缘、`R` 喜好、`T` 时间线、`X0..X14` 自己开的。

## 东西放哪

默认在 `~/.dsh/plastic-memory/`，`MEMTREE_HOME` 能改。

```
plastic-memory/
  folders.json        # 有哪些分区
  M/notes.md          # 一块一个文件
  P/notes.md
  _trash/2026-10-24.md
```

每行是 `id|时间戳|标记|文本`，纯文本，想手动改也随便。

## 忘得慢一点，也忘得干净一点

人的记忆是这样：刚发生的事清楚，过一阵模糊，再久就只剩个大概，最后忘掉。

这里照着来：

- 7 天内，怎么记的怎么留着
- 7 到 30 天，挑重要的留下，剩下的扫进回收站
- 过了 30 天，整条进回收站

重要的就加个 `*`，能多活一阵。

主人是谁、跟他约过什么，这两块永远不删。约定办完了的（打 ✓），一个月后清掉。

## 更新日志

### v1.1.0

- 单条从 10 字放宽到 30 字，10 字真不够用
- 变成能装的 DSH 插件，四个工具：`plastic_memory_idx` / `open` / `add` / `gc`
- 设置里多了一页「可塑性记忆」，左边分区右边条目
- 会话顶栏加了个 🧠，点开直接翻
- 修了两个会把 DSH 搞崩的错：`exports` 少写 `./client`、工具少写 `output`

### v1.0.0

- 第一版：分文件夹存、先看索引再翻、遗忘曲线、主人和约定不删

## 下载

[deepseek-plastic-memory-v1.1.0.zip](https://github.com/Yixianqzm/deepseek-plastic-memory/releases/download/v1.1.0/deepseek-plastic-memory-v1.1.0.zip)

更多版本在 [Releases](https://github.com/Yixianqzm/deepseek-plastic-memory/releases)。

## 一句废话

别往这里记密码、token、密钥、身份证、银行卡号。这玩意儿就是几个纯文本文件，躺硬盘里谁都能看见。

## License

MIT

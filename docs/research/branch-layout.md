# 分支布局候选研究

2026-10-25。状态：研究材料；方案尚未决定。问题是可变尺寸文档卡片的分支分组、密集叶子长列和连接线避让，三者需分别评价。

## 一手资料确认的行为

AntV 源码链接固定到调查时的提交 `56dcc56baea734f86dd78361d051e67bea4a3971`，避免后续版本改变语义。

| 候选 | 实际做法 | 是否直接缓解大量叶子同列 |
| --- | --- | --- |
| AntV indented | 按深度优先顺序逐个累加纵坐标，横坐标由深度和缩进决定。`dropCap=false` 可让首子节点与父节点同行。[源码](https://github.com/antvis/hierarchy/blob/56dcc56baea734f86dd78361d051e67bea4a3971/src/layout/indented.ts) | 不会自动换列；目录形状的竖长列表就是它的基本形态。 |
| AntV compactBox | 根据真实宽高建立矩形包围盒，以非分层 tidy 算法分离子树轮廓，子节点前进距离由父节点尺寸决定。[源码](https://github.com/antvis/hierarchy/blob/56dcc56baea734f86dd78361d051e67bea4a3971/src/layout/non-layered-tidy.ts) | 压缩子树空白；同一父节点的等尺寸叶子仍在同一前进位置，不会自动交错成多列。 |
| AntV mindmap / `H` | mindmap 用子树总高度分配纵向空间；`H` 经公共入口把根的直接子树分到左右。[mindmap](https://github.com/antvis/hierarchy/blob/56dcc56baea734f86dd78361d051e67bea4a3971/src/layout/mindmap.ts)、[方向入口](https://github.com/antvis/hierarchy/blob/56dcc56baea734f86dd78361d051e67bea4a3971/src/layout/do-layout.ts) | 能分散根的叶子或一级分支；不会递归地把每个内部父节点的密集叶子拆到左右。 |
| ELK Layer Unzipping | 在 crossing minimization 之后，把一个层中的节点交替分到多个子层，保持已有节点/边顺序；默认关闭。[选项](https://eclipse.dev/elk/reference/options/org-eclipse-elk-layered-layerUnzipping-strategy.html) | 是；官方说明其目标包括降低总高度，以增加沿布局方向的层数为代价。[说明](https://eclipse.dev/elk/blog/posts/2024/24-12-06-layer-unzipping.html) |
| Graphviz unflatten → dot | 预处理叶边的 `minlen`，使其在 1 至指定值之间交错；也可用不可见边约束孤立节点。[手册](https://www.graphviz.org/pdf/unflatten.1.pdf) | 是；官方明确针对叶子多导致过宽或过高的图，后续仍需 dot 完成布局。 |

AntV 左右分配只遍历根的直接 children；默认按一级子树数量分成两半，非按其高度或面积均衡。可通过 `getSide` 自定义。[分配源码](https://github.com/antvis/hierarchy/blob/56dcc56baea734f86dd78361d051e67bea4a3971/src/layout/separate-root.ts)

ELK 子层数默认 2，可在层内节点上配置；同层多个值取最小。官方参考页的完整键为 `org.eclipse.elk.layered.layerUnzipping.layerSplit`；应优先参考选项页，博客示例键省略了 `layered`。[子层配置](https://eclipse.dev/elk/reference/options/org-eclipse-elk-layered-layerUnzipping-layerSplit.html)

## 尺寸、真实关系与走线

- AntV hierarchy 的共同节点构建器读取 `getWidth/getHeight` 和横纵间隔，把它们计入包围盒；上述树算法输出节点位置，没有输出绕障碍物的边路由。[节点构建器](https://github.com/antvis/hierarchy/blob/56dcc56baea734f86dd78361d051e67bea4a3971/src/layout/hierarchy.ts)
- ELK JSON 接收每个节点的 `width/height`，边用 `sources/targets` 标识真实端点，布局结果可含边的起终点和折点。[数据格式](https://eclipse.dev/elk/documentation/tooldevelopers/graphdatastructure/jsonformat.html)
- ELK Layered 支持直线、正交、样条；正交模式支持端口约束。它另有节点与边、跨层节点与边的间距选项，布局与路由共同计算。[算法](https://eclipse.dev/elk/reference/algorithms/org-eclipse-elk-layered.html)、[边节点间距](https://eclipse.dev/elk/reference/options/org-eclipse-elk-spacing-edgeNode.html)、[层间边节点间距](https://eclipse.dev/elk/reference/options/org-eclipse-elk-layered-spacing-edgeNodeBetweenLayers.html)
- Graphviz 的 `splines=true` 明确让样条绕过节点；`ortho` 文档说明当前不处理 ports 或 dot 边标签。这些是路由能力，不能归功于 unflatten 本身。[路由](https://graphviz.org/docs/attrs/splines/)
- unflatten 的交错修改边长度约束，不把真实兄弟变成父子；但 `-c` 添加的不可见边属于布局约束，不能导回业务关系。[手册](https://www.graphviz.org/pdf/unflatten.1.pdf)

## 对 Rabbithole 的推论，尚非产品决策

1. **缩进竖排或 compactBox 不足以解决密集叶子长列。** 前者保证阅读顺序直观，后者减少空白；二者都没有“达到高度预算就换列”的机制。纯粹减小间距无法消除卡片本身的高度总和。
2. **左右脑图适合把根的一级分支摊开。** 若 20 个叶子都属于内部节点 A，根处左右分配只会把整个 A 子树移到一边。需要递归左右分散、叶子交错列或局部换列等额外规则，不能承诺直接套 mindmap 即解决。
3. **ELK unzipping / unflatten 更接近同父叶子多列交错。** 视觉层数可以超过真实关系深度，真实父子边保持原端点；需要接受“同一深度不必同一列”和更长的边。它们不是自动按视口高度进行精确分栏的承诺。
4. **若“不覆盖其他分支连接线”为硬约束，必须连同路由比较。** AntV 坐标结果搭配任意现有贝塞尔线不构成保证；ELK 应消费完整折线路径，Graphviz 应消费完整样条，而不是只拷贝节点坐标。
5. **输入必须是最终卡片尺寸。** 内容更新、缩放字体、展开折叠会改变障碍物；布局后继续使用旧尺寸就不再具有避让依据。可固定卡片窗口，也可在尺寸变化时重算，取舍待定。
6. **不直接传递 Rabbithole 的 `collapsed` 字段给 AntV hierarchy。** AntV 看到该字段会停止读取后代；Rabbithole 的卡片折叠仍展示后代。适配层应保留全部应展示节点，只改变高度。[AntV 构建规则](https://github.com/antvis/hierarchy/blob/56dcc56baea734f86dd78361d051e67bea4a3971/src/layout/hierarchy.ts)、[本地折叠](../../src/ui/canvas/fold.js)
7. **选择 Ask 的原文锚点与文档内部滚动仍需单独验证。** 能配置节点边界端口不等于能自动追踪滚动中的文本锚点；路由的端口与卡片几何变化必须保持一致。

## 最值得继续验证的三个参考

- [ELK Layer Unzipping](https://eclipse.dev/elk/blog/posts/2024/24-12-06-layer-unzipping.html)：观察密集层拆成 2–3 个子层的形状，再结合正交路由测试卡片避让。
- [Graphviz unflatten 手册](https://www.graphviz.org/pdf/unflatten.1.pdf)：用最小的叶边交错规则验证长列是否确实缩短，保持业务树不变。
- [AntV 非分层 tidy 源码](https://github.com/antvis/hierarchy/blob/56dcc56baea734f86dd78361d051e67bea4a3971/src/layout/non-layered-tidy.ts)：作为可变矩形和子树紧凑排列的基线，明确与多列叶子问题的差别。

后续比较应使用同一组真实尺寸：单父 20 个叶子、一个内部父节点 20 个叶子、宽高混合、多层分叉。分别检查总宽高、分支连续性、真实端点、卡片与非关联边相交、尺寸变化后的位移；当前未做这些视觉实验或采用候选库。

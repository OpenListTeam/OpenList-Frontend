/**
 * 批注增量保存队列。
 *
 * 保存是异步的：请求进行期间用户可以继续编辑同一条批注，甚至把它删掉。
 * 因此「失败后把整批放回队列」不能无条件覆盖——否则旧内容会盖掉新编辑，
 * 或者同一 ID 同时留下 upsert 与 delete（后端先更新再删除，最终把该删的留下
 * 该留的删掉）。这里把规则集中到一处：
 *   - upsert 与 delete 对同一 ID 互斥；
 *   - 失败重入队时，只恢复「当前队列里没有更新操作」的条目。
 */

export interface QueuedAnnotation {
  id: string
}

export interface AnnotationBatch<T extends QueuedAnnotation> {
  upserts: T[]
  deletes: string[]
}

export const createAnnotationQueue = <T extends QueuedAnnotation>() => {
  const upserts = new Map<string, T>()
  const deletes = new Set<string>()

  const upsert = (annotation: T) => {
    // 新建/更新会取消同一 ID 的待删除，避免两条队列互相打架
    deletes.delete(annotation.id)
    upserts.set(annotation.id, annotation)
  }

  const remove = (id: string) => {
    upserts.delete(id)
    deletes.add(id)
  }

  /** 取走当前全部待提交操作（调用方负责在成功后丢弃、失败时 restore） */
  const take = (): AnnotationBatch<T> => {
    const batch: AnnotationBatch<T> = {
      upserts: [...upserts.values()],
      deletes: [...deletes],
    }
    upserts.clear()
    deletes.clear()
    return batch
  }

  /**
   * 把失败的一批放回队列。
   * 请求期间产生的新操作优先：该 ID 已经有新的 upsert/delete 时，旧操作直接丢弃。
   */
  const restore = (batch: AnnotationBatch<T>) => {
    for (const id of batch.deletes) {
      if (deletes.has(id) || upserts.has(id)) continue
      deletes.add(id)
    }
    for (const annotation of batch.upserts) {
      if (upserts.has(annotation.id) || deletes.has(annotation.id)) continue
      upserts.set(annotation.id, annotation)
    }
  }

  const size = () => upserts.size + deletes.size

  return { upsert, remove, take, restore, size }
}

export type AnnotationQueue<T extends QueuedAnnotation> = ReturnType<
  typeof createAnnotationQueue<T>
>

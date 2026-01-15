import { useState, useCallback } from 'react'
import type {
  Todo,
  Section,
  Priority,
  Timeframe,
  ViewTimeframe,
} from '@/types/todo'
import {
  loadTodos,
  saveTodos,
  loadSections,
  loadCollapsed,
  saveCollapsed,
} from '@/lib/storage'

// ユーティリティ関数
export const timeframeLabel = (tf: Timeframe): string =>
  tf === 'today' ? '今日' :
  tf === 'week' ? '週' :
  tf === 'month' ? '月' : '年'

export const priorityLabel = (p: Priority): string => `P${p}`

export const priorityColor = (p: Priority): string =>
  p === 1 ? 'p1' : p === 2 ? 'p2' : p === 3 ? 'p3' : 'p4'

export interface UseTodosOptions {
  currentTimeframe?: ViewTimeframe
  activeView?: 'inbox' | 'label' | 'filter' | 'project'
  selectedProjectId?: string | null
}

export interface UseTodosReturn {
  // 状態
  todos: Todo[]
  setTodos: React.Dispatch<React.SetStateAction<Todo[]>>
  filter: 'all' | 'active' | 'completed'
  setFilter: React.Dispatch<React.SetStateAction<'all' | 'active' | 'completed'>>
  sections: Section[]
  setSections: React.Dispatch<React.SetStateAction<Section[]>>
  collapsed: Set<string>
  setCollapsed: React.Dispatch<React.SetStateAction<Set<string>>>
  todosHistory: Todo[][]
  setTodosHistory: React.Dispatch<React.SetStateAction<Todo[][]>>
  selectionMode: boolean
  setSelectionMode: React.Dispatch<React.SetStateAction<boolean>>
  selectedTodoIds: Set<string>
  setSelectedTodoIds: React.Dispatch<React.SetStateAction<Set<string>>>
  deleteTargetId: string | null
  setDeleteTargetId: React.Dispatch<React.SetStateAction<string | null>>
  showDeleteConfirm: boolean
  setShowDeleteConfirm: React.Dispatch<React.SetStateAction<boolean>>
  showBulkDeleteConfirm: boolean
  setShowBulkDeleteConfirm: React.Dispatch<React.SetStateAction<boolean>>
  editingId: string | null
  setEditingId: React.Dispatch<React.SetStateAction<string | null>>
  editText: string
  setEditText: React.Dispatch<React.SetStateAction<string>>

  // 操作関数
  updateTodosWithHistory: (updater: (prev: Todo[]) => Todo[]) => void
  toggleTodo: (id: string) => void
  requestDeleteTodo: (id: string) => void
  executeTodoDelete: (id: string) => void
  confirmTodoDelete: (skipNextTime: boolean) => void
  cancelTodoDelete: () => void
  toggleSelectionMode: () => void
  toggleTodoSelection: (id: string) => void
  selectAllVisibleTodos: () => void
  clearSelection: () => void
  requestDeleteSelectedTodos: () => void
  executeDeleteSelectedTodos: () => void
  cancelBulkDelete: () => void
  toggleSelectedTodosCompletion: () => void
  setSelectedTodosPriority: (priority: Priority) => void
  archiveCompleted: () => void
  cycleTimeframe: (id: string, setCurrentTimeframe: (tf: Timeframe) => void) => void
  cyclePriority: (id: string) => void
  startEdit: (todo: Todo) => void
  saveEdit: () => void
  cancelEdit: () => void
  toggleCollapse: (todoId: string) => void

  // ユーティリティ関数
  hasChildren: (todoId: string) => boolean
  getDepth: (todo: Todo) => number
  isHidden: (todo: Todo) => boolean
  buildTree: (parentId: string | null, displayTodos: Todo[]) => Todo[]
  getDescendantIds: (parentId: string) => string[]
}

export function useTodos(options: UseTodosOptions = {}): UseTodosReturn {
  const { activeView = 'inbox' } = options

  // Todo関連の状態
  const [todos, setTodos] = useState<Todo[]>(loadTodos)
  const [filter, setFilter] = useState<'all' | 'active' | 'completed'>('all')
  const [sections, setSections] = useState<Section[]>(loadSections)
  const [collapsed, setCollapsed] = useState<Set<string>>(loadCollapsed)
  const [todosHistory, setTodosHistory] = useState<Todo[][]>([])

  // 選択モード関連
  const [selectionMode, setSelectionMode] = useState(false)
  const [selectedTodoIds, setSelectedTodoIds] = useState<Set<string>>(new Set())

  // 削除確認関連
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [showBulkDeleteConfirm, setShowBulkDeleteConfirm] = useState(false)
  const [confirmDeleteDisabled] = useState(() =>
    localStorage.getItem('calm-todo-skip-delete-confirm') === 'true'
  )

  // 編集関連
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editText, setEditText] = useState('')

  // 履歴を保存しながらTodosを更新するラッパー関数
  const updateTodosWithHistory = useCallback((updater: (prev: Todo[]) => Todo[]) => {
    setTodosHistory(prev => [...prev.slice(-19), todos])
    setTodos(prev => {
      const updated = updater(prev)
      saveTodos(updated)
      return updated
    })
  }, [todos])

  // 子孫タスクのIDを取得
  const getDescendantIds = useCallback((parentId: string): string[] => {
    const children = todos.filter(t => t.parentId === parentId)
    return children.flatMap(c => [c.id, ...getDescendantIds(c.id)])
  }, [todos])

  // タスクの完了/未完了切り替え
  const toggleTodo = useCallback((id: string) => {
    setTodosHistory(prevHistory => [...prevHistory.slice(-19), todos])
    setTodos(prev => {
      const target = prev.find(t => t.id === id)
      if (!target) return prev
      const newCompleted = !target.completed

      const getDescendantIdsLocal = (parentId: string): string[] => {
        const children = prev.filter(t => t.parentId === parentId)
        return children.flatMap(c => [c.id, ...getDescendantIdsLocal(c.id)])
      }
      const idsToToggle = new Set([id, ...getDescendantIdsLocal(id)])

      const now = Date.now()
      let updated = prev.map(todo => {
        if (!idsToToggle.has(todo.id)) return todo
        const updatedTodo = { ...todo, completed: newCompleted, completedAt: newCompleted ? now : null, karmaAwarded: newCompleted }
        if (newCompleted && updatedTodo.dueDateNotification) {
          updatedTodo.dueDateNotification = { ...updatedTodo.dueDateNotification, followUpCount: 0, notifiedAt: null }
        }
        return updatedTodo
      })

      // 子タスクを完了した場合、親タスクのすべての子が完了したか確認
      if (newCompleted && target.parentId) {
        const checkAndCompleteParent = (parentId: string | null) => {
          if (!parentId) return
          const siblings = updated.filter(t => t.parentId === parentId)
          const allSiblingsCompleted = siblings.length > 0 && siblings.every(t => t.completed)
          if (allSiblingsCompleted) {
            updated = updated.map(t => {
              if (t.id !== parentId) return t
              const parentTodo = { ...t, completed: true, completedAt: now, karmaAwarded: true }
              if (parentTodo.dueDateNotification) {
                parentTodo.dueDateNotification = { ...parentTodo.dueDateNotification, followUpCount: 0, notifiedAt: null }
              }
              return parentTodo
            })
            const parent = updated.find(t => t.id === parentId)
            if (parent?.parentId) {
              checkAndCompleteParent(parent.parentId)
            }
          }
        }
        checkAndCompleteParent(target.parentId)
      }

      saveTodos(updated)
      return updated
    })
  }, [todos])

  // 削除リクエスト（確認モーダル表示または直接削除）
  const requestDeleteTodo = useCallback((id: string) => {
    if (confirmDeleteDisabled) {
      const idsToDelete = new Set([id, ...getDescendantIds(id)])
      updateTodosWithHistory(prev => prev.filter(todo => !idsToDelete.has(todo.id)))
    } else {
      setDeleteTargetId(id)
      setShowDeleteConfirm(true)
    }
  }, [confirmDeleteDisabled, getDescendantIds, updateTodosWithHistory])

  // 実際の削除処理
  const executeTodoDelete = useCallback((id: string) => {
    const idsToDelete = new Set([id, ...getDescendantIds(id)])
    updateTodosWithHistory(prev => prev.filter(todo => !idsToDelete.has(todo.id)))
  }, [getDescendantIds, updateTodosWithHistory])

  // 削除確認モーダルから確定
  const confirmTodoDelete = useCallback((skipNextTime: boolean) => {
    if (deleteTargetId) {
      if (skipNextTime) {
        localStorage.setItem('calm-todo-skip-delete-confirm', 'true')
      }
      executeTodoDelete(deleteTargetId)
      setShowDeleteConfirm(false)
      setDeleteTargetId(null)
    }
  }, [deleteTargetId, executeTodoDelete])

  // 削除キャンセル
  const cancelTodoDelete = useCallback(() => {
    setShowDeleteConfirm(false)
    setDeleteTargetId(null)
  }, [])

  // 複数選択モードの切り替え
  const toggleSelectionMode = useCallback(() => {
    if (selectionMode) {
      setSelectedTodoIds(new Set())
    }
    setSelectionMode(!selectionMode)
  }, [selectionMode])

  // 個別タスクの選択/解除
  const toggleTodoSelection = useCallback((id: string) => {
    setSelectedTodoIds(prev => {
      const next = new Set(prev)
      const descendantIds = getDescendantIds(id)

      if (next.has(id)) {
        next.delete(id)
        descendantIds.forEach(childId => next.delete(childId))
      } else {
        next.add(id)
        descendantIds.forEach(childId => next.add(childId))
      }
      return next
    })
  }, [getDescendantIds])

  // 表示中のすべてのタスクを選択（要: displayTodosをbuildTree経由で取得）
  const selectAllVisibleTodos = useCallback(() => {
    // この関数はApp.tsx側でbuildTreeを使って実装される
    // ここでは基本的なセットアップのみ
    const allIds = new Set<string>()
    todos.filter(t => t.parentId === null).forEach(id => {
      allIds.add(id.id)
      getDescendantIds(id.id).forEach(childId => allIds.add(childId))
    })
    setSelectedTodoIds(allIds)
  }, [todos, getDescendantIds])

  // すべての選択を解除
  const clearSelection = useCallback(() => {
    setSelectedTodoIds(new Set())
  }, [])

  // 選択したタスクを一括削除リクエスト
  const requestDeleteSelectedTodos = useCallback(() => {
    if (selectedTodoIds.size === 0) return
    if (confirmDeleteDisabled) {
      const allIdsToDelete = new Set<string>()
      selectedTodoIds.forEach(id => {
        allIdsToDelete.add(id)
        getDescendantIds(id).forEach(childId => allIdsToDelete.add(childId))
      })
      updateTodosWithHistory(prev => prev.filter(todo => !allIdsToDelete.has(todo.id)))
      setSelectedTodoIds(new Set())
      setSelectionMode(false)
    } else {
      setShowBulkDeleteConfirm(true)
    }
  }, [selectedTodoIds, confirmDeleteDisabled, getDescendantIds, updateTodosWithHistory])

  // 選択したタスクを実際に削除
  const executeDeleteSelectedTodos = useCallback(() => {
    if (selectedTodoIds.size === 0) return

    const allIdsToDelete = new Set<string>()
    selectedTodoIds.forEach(id => {
      allIdsToDelete.add(id)
      getDescendantIds(id).forEach(childId => allIdsToDelete.add(childId))
    })

    updateTodosWithHistory(prev => prev.filter(todo => !allIdsToDelete.has(todo.id)))
    setSelectedTodoIds(new Set())
    setSelectionMode(false)
    setShowBulkDeleteConfirm(false)
  }, [selectedTodoIds, getDescendantIds, updateTodosWithHistory])

  // 一括削除キャンセル
  const cancelBulkDelete = useCallback(() => {
    setShowBulkDeleteConfirm(false)
  }, [])

  // 選択したタスクを一括完了/未完了切り替え
  const toggleSelectedTodosCompletion = useCallback(() => {
    if (selectedTodoIds.size === 0) return

    const selectedTodos = todos.filter(t => selectedTodoIds.has(t.id))
    const allCompleted = selectedTodos.every(t => t.completed)
    const newCompleted = !allCompleted

    updateTodosWithHistory(prev => prev.map(todo =>
      selectedTodoIds.has(todo.id)
        ? { ...todo, completed: newCompleted, karmaAwarded: newCompleted }
        : todo
    ))
  }, [selectedTodoIds, todos, updateTodosWithHistory])

  // 選択したタスクの優先度を一括変更
  const setSelectedTodosPriority = useCallback((priority: Priority) => {
    if (selectedTodoIds.size === 0) return

    updateTodosWithHistory(prev => prev.map(todo =>
      selectedTodoIds.has(todo.id)
        ? { ...todo, priority }
        : todo
    ))
  }, [selectedTodoIds, updateTodosWithHistory])

  // 完了タスクをアーカイブ
  const archiveCompleted = useCallback(() => {
    updateTodosWithHistory(prev => prev.map(todo =>
      todo.completed && !todo.archived
        ? { ...todo, archived: true, archivedAt: Date.now() }
        : todo
    ))
  }, [updateTodosWithHistory])

  // タイムフレームのサイクル
  const cycleTimeframe = useCallback((id: string, setCurrentTimeframe: (tf: Timeframe) => void) => {
    const todo = todos.find(t => t.id === id)
    if (!todo) return
    const next: Timeframe =
      todo.timeframe === 'today' ? 'week' :
      todo.timeframe === 'week' ? 'month' :
      todo.timeframe === 'month' ? 'year' : 'today'

    updateTodosWithHistory(prev => prev.map(t => {
      if (t.id === id) return { ...t, timeframe: next }
      if (t.parentId === id) return { ...t, timeframe: next }
      return t
    }))

    if (activeView === 'inbox') {
      setCurrentTimeframe(next)
    }
  }, [todos, activeView, updateTodosWithHistory])

  // 優先度のサイクル
  const cyclePriority = useCallback((id: string) => {
    updateTodosWithHistory(prev => prev.map(todo => {
      if (todo.id !== id) return todo
      const next: Priority = todo.priority === 4 ? 1 : (todo.priority + 1) as Priority
      return { ...todo, priority: next }
    }))
  }, [updateTodosWithHistory])

  // 編集開始
  const startEdit = useCallback((todo: Todo) => {
    setEditingId(todo.id)
    setEditText(todo.text)
  }, [])

  // 編集保存
  const saveEdit = useCallback(() => {
    if (!editingId || !editText.trim()) return
    updateTodosWithHistory(prev => prev.map(todo =>
      todo.id === editingId ? { ...todo, text: editText.trim() } : todo
    ))
    setEditingId(null)
    setEditText('')
  }, [editingId, editText, updateTodosWithHistory])

  // 編集キャンセル
  const cancelEdit = useCallback(() => {
    setEditingId(null)
    setEditText('')
  }, [])

  // 折りたたみ切り替え
  const toggleCollapse = useCallback((todoId: string) => {
    setCollapsed(prev => {
      const next = new Set(prev)
      if (next.has(todoId)) {
        next.delete(todoId)
      } else {
        next.add(todoId)
      }
      saveCollapsed(next)
      return next
    })
  }, [])

  // 子タスクがあるかチェック
  const hasChildren = useCallback((todoId: string) => {
    return todos.some(t => t.parentId === todoId)
  }, [todos])

  // タスクの深さを取得
  const getDepth = useCallback((todo: Todo): number => {
    if (!todo.parentId) return 0
    const parent = todos.find(t => t.id === todo.parentId)
    return parent ? 1 + getDepth(parent) : 0
  }, [todos])

  // タスクが非表示かチェック
  const isHidden = useCallback((todo: Todo): boolean => {
    if (!todo.parentId) return false
    if (collapsed.has(todo.parentId)) return true
    const parent = todos.find(t => t.id === todo.parentId)
    return parent ? isHidden(parent) : false
  }, [todos, collapsed])

  // ツリー構築
  const buildTree = useCallback((parentId: string | null, displayTodos: Todo[]): Todo[] => {
    const children = displayTodos.filter(t => t.parentId === parentId)
    return children.flatMap(child => [child, ...buildTree(child.id, displayTodos)])
  }, [])

  return {
    // 状態
    todos,
    setTodos,
    filter,
    setFilter,
    sections,
    setSections,
    collapsed,
    setCollapsed,
    todosHistory,
    setTodosHistory,
    selectionMode,
    setSelectionMode,
    selectedTodoIds,
    setSelectedTodoIds,
    deleteTargetId,
    setDeleteTargetId,
    showDeleteConfirm,
    setShowDeleteConfirm,
    showBulkDeleteConfirm,
    setShowBulkDeleteConfirm,
    editingId,
    setEditingId,
    editText,
    setEditText,

    // 操作関数
    updateTodosWithHistory,
    toggleTodo,
    requestDeleteTodo,
    executeTodoDelete,
    confirmTodoDelete,
    cancelTodoDelete,
    toggleSelectionMode,
    toggleTodoSelection,
    selectAllVisibleTodos,
    clearSelection,
    requestDeleteSelectedTodos,
    executeDeleteSelectedTodos,
    cancelBulkDelete,
    toggleSelectedTodosCompletion,
    setSelectedTodosPriority,
    archiveCompleted,
    cycleTimeframe,
    cyclePriority,
    startEdit,
    saveEdit,
    cancelEdit,
    toggleCollapse,

    // ユーティリティ関数
    hasChildren,
    getDepth,
    isHidden,
    buildTree,
    getDescendantIds,
  }
}

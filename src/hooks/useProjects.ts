import { useState, useCallback } from 'react'
import {
  loadProjects,
  saveProjects,
  loadLabels,
  saveLabels,
  loadLabelDefinitions,
  saveLabelDefinitions,
} from '@/lib/storage'
import type { Project, LabelDefinition, Todo } from '@/types/todo'
import { LABEL_COLORS } from '@/types/todo'

// プロジェクト・ラベル関連の状態とロジックを管理するカスタムフック
export function useProjects() {
  // プロジェクト関連の状態
  const [projects, setProjects] = useState<Project[]>(loadProjects)
  const [newProjectName, setNewProjectName] = useState('')
  const [newProjectColor, setNewProjectColor] = useState('#e07b39')
  const [newProjectParentId, setNewProjectParentId] = useState<string | null>(null)

  // ラベル関連の状態
  const [savedLabels, setSavedLabels] = useState<string[]>(loadLabels)
  const [labelDefinitions, setLabelDefinitions] = useState<LabelDefinition[]>(loadLabelDefinitions)
  const [labelTodoId, setLabelTodoId] = useState<string | null>(null)
  const [newLabelInput, setNewLabelInput] = useState('')
  const [newLabelName, setNewLabelName] = useState('')
  const [newLabelColor, setNewLabelColor] = useState<string>(LABEL_COLORS[0])

  // プロジェクトをlocalStorageに保存
  const persistProjects = useCallback((updatedProjects: Project[]) => {
    saveProjects(updatedProjects)
  }, [])

  // プロジェクト追加
  const addProject = useCallback((
    onActivityLog?: (log: { type: 'project_created'; projectId: string; projectName: string }) => void,
    onCloseModal?: () => void
  ) => {
    const name = newProjectName.trim()
    if (!name) return

    const newProject: Project = {
      id: crypto.randomUUID(),
      name,
      color: newProjectColor,
      order: projects.length,
      parentId: newProjectParentId,
      isFavorite: false,
      isArchived: false,
    }

    setProjects(prev => {
      const updated = [...prev, newProject]
      persistProjects(updated)
      return updated
    })

    if (onActivityLog) {
      onActivityLog({
        type: 'project_created',
        projectId: newProject.id,
        projectName: newProject.name
      })
    }

    if (onCloseModal) {
      onCloseModal()
    }

    setNewProjectName('')
    setNewProjectColor('#e07b39')
    setNewProjectParentId(null)

    return newProject
  }, [newProjectName, newProjectColor, newProjectParentId, projects.length, persistProjects])

  // お気に入りトグル
  const toggleProjectFavorite = useCallback((id: string) => {
    setProjects(prev => {
      const updated = prev.map(p => p.id === id ? { ...p, isFavorite: !p.isFavorite } : p)
      persistProjects(updated)
      return updated
    })
  }, [persistProjects])

  // サブプロジェクト取得
  const getSubProjects = useCallback((parentId: string | null): Project[] => {
    return projects.filter(p => p.parentId === parentId && !p.isArchived).sort((a, b) => a.order - b.order)
  }, [projects])

  // お気に入りプロジェクト取得
  const getFavoriteProjects = useCallback((): Project[] => {
    return projects.filter(p => p.isFavorite && !p.isArchived)
  }, [projects])

  // プロジェクト削除
  const deleteProject = useCallback((
    id: string,
    updateTodos: (updater: (prev: Todo[]) => Todo[]) => void,
    selectedProjectId: string | null,
    onProjectDeleted?: () => void
  ) => {
    setProjects(prev => {
      const updated = prev.filter(p => p.id !== id)
      persistProjects(updated)
      return updated
    })

    // プロジェクトに属するタスクのprojectIdをnullに
    updateTodos(prev => prev.map(t => t.projectId === id ? { ...t, projectId: null } : t))

    if (selectedProjectId === id && onProjectDeleted) {
      onProjectDeleted()
    }
  }, [persistProjects])

  // 全ラベルを収集（savedLabelsとtodosから両方マージ）
  const getAllLabels = useCallback((todos: Todo[]): string[] => {
    return [...new Set([...savedLabels, ...todos.flatMap(t => t.labels || [])])].sort()
  }, [savedLabels])

  // 「未設定」ラベルの重複を回避して一意な名前を生成
  const getUniqueLabelName = useCallback((baseName: string, todos: Todo[]): string => {
    const allLabels = getAllLabels(todos)
    if (!allLabels.includes(baseName)) return baseName
    let counter = 1
    while (allLabels.includes(`${baseName} ${counter}`)) {
      counter++
    }
    return `${baseName} ${counter}`
  }, [getAllLabels])

  // ラベルモーダルを開く
  const openLabelModal = useCallback((todoId: string, setShowLabelModal: (show: boolean) => void) => {
    setLabelTodoId(todoId)
    setNewLabelInput('')
    setShowLabelModal(true)
  }, [])

  // ラベルモーダルを閉じる
  const closeLabelModal = useCallback((setShowLabelModal: (show: boolean) => void) => {
    setShowLabelModal(false)
    setLabelTodoId(null)
    setNewLabelInput('')
  }, [])

  // タスクにラベルを追加
  const addLabelToTodo = useCallback((
    updateTodos: (updater: (prev: Todo[]) => Todo[]) => void
  ) => {
    const label = newLabelInput.trim().replace(/^#/, '') // #があれば削除
    if (!label || !labelTodoId) return

    updateTodos(prev => prev.map(t => {
      if (t.id !== labelTodoId) return t
      if (t.labels.includes(label)) return t // 重複は追加しない
      return { ...t, labels: [...t.labels, label] }
    }))

    // savedLabelsにも追加（タスク削除後も保持）
    if (!savedLabels.includes(label)) {
      const newSavedLabels = [...savedLabels, label].sort()
      setSavedLabels(newSavedLabels)
      saveLabels(newSavedLabels)
    }

    setNewLabelInput('')
  }, [newLabelInput, labelTodoId, savedLabels])

  // タスクからラベルを削除
  const removeLabelFromTodo = useCallback((
    todoId: string,
    label: string,
    updateTodos: (updater: (prev: Todo[]) => Todo[]) => void
  ) => {
    updateTodos(prev => prev.map(t => {
      if (t.id !== todoId) return t
      return { ...t, labels: t.labels.filter(l => l !== label) }
    }))
  }, [])

  // ラベル定義を保存
  const persistLabelDefinitions = useCallback((definitions: LabelDefinition[]) => {
    setLabelDefinitions(definitions)
    saveLabelDefinitions(definitions)
  }, [])

  // savedLabelsを保存
  const persistSavedLabels = useCallback((labels: string[]) => {
    setSavedLabels(labels)
    saveLabels(labels)
  }, [])

  return {
    // プロジェクト関連の状態
    projects,
    setProjects,
    newProjectName,
    setNewProjectName,
    newProjectColor,
    setNewProjectColor,
    newProjectParentId,
    setNewProjectParentId,

    // ラベル関連の状態
    savedLabels,
    setSavedLabels,
    labelDefinitions,
    setLabelDefinitions,
    labelTodoId,
    setLabelTodoId,
    newLabelInput,
    setNewLabelInput,
    newLabelName,
    setNewLabelName,
    newLabelColor,
    setNewLabelColor,

    // プロジェクト関連の関数
    addProject,
    toggleProjectFavorite,
    getSubProjects,
    getFavoriteProjects,
    deleteProject,
    persistProjects,

    // ラベル関連の関数
    getAllLabels,
    getUniqueLabelName,
    openLabelModal,
    closeLabelModal,
    addLabelToTodo,
    removeLabelFromTodo,
    persistLabelDefinitions,
    persistSavedLabels,

    // 定数
    LABEL_COLORS,
  }
}

export type UseProjectsReturn = ReturnType<typeof useProjects>

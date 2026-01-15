import type { Todo, Priority, LabelDefinition } from '@/types/todo'
import type { RecurrencePattern } from '@/lib/parseNaturalLanguage'

// ========================================
// BoardView Component
// ========================================

interface BoardViewProps {
  displayTodos: Todo[]
  labelDefinitions: LabelDefinition[]
  toggleTodo: (id: string) => void
  priorityColor: (p: Priority) => string
  formatDueDate: (timestamp: number, recurrence?: RecurrencePattern | null) => string
  isDueDateOverdue: (timestamp: number) => boolean
}

export function BoardView({
  displayTodos,
  labelDefinitions,
  toggleTodo,
  priorityColor,
  formatDueDate,
  isDueDateOverdue,
}: BoardViewProps) {
  return (
    <div className="board-view">
      <div className="board-column">
        <div className="board-column-header">
          <h3>未着手</h3>
          <span className="board-column-count">{displayTodos.filter(t => !t.completed && t.parentId === null).length}</span>
        </div>
        <div className="board-column-tasks">
          {displayTodos.filter(t => !t.completed && t.parentId === null).map(todo => (
            <div key={todo.id} className={'board-task priority-' + priorityColor(todo.priority)}>
              <div className="board-task-header">
                <button className="checkbox-small" onClick={() => toggleTodo(todo.id)}></button>
                <span className={'priority-dot priority-' + priorityColor(todo.priority)}></span>
              </div>
              <div className="board-task-title">{todo.text}</div>
              {todo.dueDate && (
                <div className={'board-task-due' + (isDueDateOverdue(todo.dueDate) ? ' overdue' : '')}>
                  📅 {formatDueDate(todo.dueDate, todo.recurrence)}
                </div>
              )}
              {todo.labels && todo.labels.length > 0 && (
                <div className="board-task-labels">
                  {todo.labels.map((label, i) => {
                    const def = labelDefinitions.find(ld => ld.name === label)
                    return <span key={i} className="label-badge-small" style={def?.color ? { backgroundColor: def.color } : undefined}>#{label}</span>
                  })}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
      <div className="board-column completed-column">
        <div className="board-column-header">
          <h3>完了</h3>
          <span className="board-column-count">{displayTodos.filter(t => t.completed && t.parentId === null).length}</span>
        </div>
        <div className="board-column-tasks">
          {displayTodos.filter(t => t.completed && t.parentId === null).map(todo => (
            <div key={todo.id} className="board-task completed">
              <div className="board-task-header">
                <button className="checkbox-small checked" onClick={() => toggleTodo(todo.id)}>✓</button>
              </div>
              <div className="board-task-title">{todo.text}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ========================================
// UpcomingView Component
// ========================================

interface UpcomingViewProps {
  todos: Todo[]
  labelDefinitions: LabelDefinition[]
  toggleTodo: (id: string) => void
  priorityColor: (p: Priority) => string
}

export function UpcomingView({
  todos,
  labelDefinitions,
  toggleTodo,
  priorityColor,
}: UpcomingViewProps) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const days = Array.from({ length: 7 }, (_, i) => {
    const date = new Date(today)
    date.setDate(date.getDate() + i)
    return date
  })
  const dayNames = ['日', '月', '火', '水', '木', '金', '土']

  return (
    <div className="upcoming-view">
      {days.map((date, index) => {
        const dayStart = date.getTime()
        const dayEnd = dayStart + 24 * 60 * 60 * 1000 - 1
        const dayTodos = todos.filter(t =>
          t.dueDate && t.dueDate >= dayStart && t.dueDate <= dayEnd && !t.completed && t.parentId === null
        )
        const isToday = index === 0

        return (
          <div key={index} className={'upcoming-day' + (isToday ? ' today' : '')}>
            <div className="upcoming-day-header">
              <span className="upcoming-day-name">
                {isToday ? '今日' : index === 1 ? '明日' : `${date.getMonth() + 1}/${date.getDate()}`}
              </span>
              <span className="upcoming-day-weekday">{dayNames[date.getDay()]}</span>
              <span className="upcoming-day-count">{dayTodos.length}件</span>
            </div>
            <div className="upcoming-day-tasks">
              {dayTodos.length === 0 ? (
                <div className="upcoming-empty">予定なし</div>
              ) : (
                dayTodos.map(todo => (
                  <div key={todo.id} className={'upcoming-task priority-' + priorityColor(todo.priority)}>
                    <button className="checkbox-small" onClick={() => toggleTodo(todo.id)}></button>
                    <span className={'priority-dot priority-' + priorityColor(todo.priority)}></span>
                    <span className="upcoming-task-text">{todo.text}</span>
                    {todo.labels && todo.labels.length > 0 && (
                      <span className="upcoming-task-labels">
                        {todo.labels.map((label, i) => {
                          const def = labelDefinitions.find(ld => ld.name === label)
                          return <span key={i} className="label-badge-small" style={def?.color ? { backgroundColor: def.color } : undefined}>#{label}</span>
                        })}
                      </span>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

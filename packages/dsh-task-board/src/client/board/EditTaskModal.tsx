/**
 * Edit-task modal: title + description + the prompt the next execution will
 * send, pre-filled from the task. Shown only for tasks that have never
 * started executing (the detail view gates on canEditTaskContent); the Host
 * still re-checks at submit, so a task that started running while the modal
 * was open fails closed and the error surfaces here.
 */
import { useState } from 'react'
import type { BoardController } from '../../core/controller.ts'
import type { TaskRecord } from '../../core/tasks.ts'
import { t } from '../locales.ts'
import css from '../board.module.css'

/** Edit-task form overlay. */
export function EditTaskModal({ controller, task, onClose }: { controller: BoardController; task: TaskRecord; onClose: () => void }) {
  const [title, setTitle] = useState(task.title)
  const [description, setDescription] = useState(task.description)
  const [prompt, setPrompt] = useState(task.prompt)
  const [error, setError] = useState<string | undefined>(undefined)
  const [pending, setPending] = useState(false)

  const submit = async (): Promise<void> => {
    if (title.trim() === '') {
      setError(t('new.required'))
      return
    }
    setPending(true)
    // The Host confirms the mutation (and its fail-closed checks); only a
    // confirmed save closes the modal.
    if (await controller.updateTask(task.id, { title, description, prompt })) {
      onClose()
      return
    }
    setPending(false)
    setError(controller.getSnapshot().transportError ?? t('new.required'))
  }

  return (
    <div className={css.modalBackdrop} onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
      <form
        className={css.modal}
        role="dialog"
        aria-label={t('edit.title')}
        onSubmit={event => { event.preventDefault(); void submit() }}
      >
        <h2 className={css.modalTitle}>{t('edit.title')}</h2>

        <label className={css.field}>
          <span className={css.fieldLabel}>{t('new.title')}</span>
          <input
            className={css.input}
            value={title}
            autoFocus
            placeholder={t('new.titlePlaceholder')}
            onChange={event => { setTitle(event.target.value); setError(undefined) }}
          />
        </label>

        <label className={css.field}>
          <span className={css.fieldLabel}>{t('new.description')}</span>
          <textarea
            className={css.input}
            rows={3}
            value={description}
            placeholder={t('new.descriptionPlaceholder')}
            onChange={event => { setDescription(event.target.value) }}
          />
        </label>

        <label className={css.field}>
          <span className={css.fieldLabel}>{t('new.prompt')}</span>
          <textarea
            className={css.input}
            rows={4}
            value={prompt}
            placeholder={t('new.promptPlaceholder')}
            onChange={event => { setPrompt(event.target.value) }}
          />
        </label>

        {error !== undefined && <p className={css.formError}>{error}</p>}

        <footer className={css.modalFooter}>
          <button type="button" className={css.ghostButton} onClick={onClose}>
            {t('new.cancel')}
          </button>
          <button type="submit" className={css.primaryButton} disabled={pending}>
            {t('edit.save')}
          </button>
        </footer>
      </form>
    </div>
  )
}

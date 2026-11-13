<script setup lang="ts">
// Renders the pending confirmDialog() request; mounted once, in App.vue.
import { computed, nextTick, ref, watch } from 'vue';
import { answerConfirm, confirmState } from '../composables/confirm.js';

const dialog = computed(() => confirmState.current);
const paragraphs = computed(() =>
  (dialog.value?.message ?? '')
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean),
);
const tone = computed(() => dialog.value?.tone ?? 'primary');
const confirmBtn = ref<HTMLButtonElement | null>(null);
const cancelBtn = ref<HTMLButtonElement | null>(null);
const checked = ref(false);

// a destructive action starts on Cancel, so a stray Enter cannot confirm it
watch(dialog, async (d) => {
  checked.value = d?.checkbox?.default ?? false;
  if (!d) return;
  await nextTick();
  (tone.value === 'danger' ? cancelBtn : confirmBtn).value?.focus();
});
</script>

<template>
  <Teleport to="body">
    <div
      v-if="dialog"
      class="confirm-overlay"
      @click.self="answerConfirm({ ok: false, checked: false })"
      @keydown.esc="answerConfirm({ ok: false, checked: false })"
    >
      <div
        class="confirm-panel"
        :class="`tone-${tone}`"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
      >
        <h3 id="confirm-title">{{ dialog.title ?? 'Please confirm' }}</h3>
        <p v-for="(p, i) in paragraphs" :key="i" class="confirm-text">{{ p }}</p>
        <label v-if="dialog.checkbox" class="confirm-checkbox">
          <input type="checkbox" v-model="checked" />
          {{ dialog.checkbox.label }}
        </label>
        <div class="confirm-actions">
          <button
            ref="cancelBtn"
            type="button"
            class="btn btn-ghost"
            @click="answerConfirm({ ok: false, checked: false })"
          >
            {{ dialog.cancelLabel ?? 'Cancel' }}
          </button>
          <button
            ref="confirmBtn"
            type="button"
            class="btn"
            :class="{ 'btn-danger': tone === 'danger', 'btn-warn': tone === 'warning' }"
            @click="answerConfirm({ ok: true, checked })"
          >
            {{ dialog.confirmLabel ?? 'Confirm' }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.confirm-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  background: rgba(15, 23, 42, 0.45);
  display: flex;
  justify-content: center;
  align-items: flex-start;
  padding: 14vh 16px 0;
  overflow: auto;
}
.confirm-panel {
  background: #fff;
  border-radius: 10px;
  border-top: 4px solid var(--primary);
  padding: 20px 24px;
  width: 440px;
  max-width: 100%;
  box-shadow: 0 10px 30px rgba(15, 23, 42, 0.25);
}
.confirm-panel.tone-danger {
  border-top-color: var(--danger);
}
.confirm-panel.tone-warning {
  border-top-color: var(--warn);
}
h3 {
  margin: 0 0 10px;
}
.confirm-text {
  margin: 0 0 8px;
  color: var(--text);
  line-height: 1.45;
  overflow-wrap: anywhere;
}
.confirm-checkbox {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin-top: 10px;
  color: var(--text);
  font-size: 0.9rem;
  cursor: pointer;
}
.confirm-checkbox input {
  width: auto;
  flex: none;
}
.confirm-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 18px;
}
</style>

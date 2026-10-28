<script lang="ts">
import { defineComponent } from "vue";
import { useCounter } from "./counter";
export default defineComponent({ setup: useCounter });
</script>

<template>
  <button @click="increment">Count: {{ count }}</button>
</template>

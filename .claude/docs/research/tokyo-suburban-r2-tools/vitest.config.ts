import { defineConfig } from 'vitest/config';
export default defineConfig({test:{include:['.claude/docs/research/tokyo-suburban-r2-tools/measure.test.ts'],environment:'node',fileParallelism:false,reporters:['dot']}});

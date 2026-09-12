/**
 * commit 规范（T0-02）：Conventional Commits + 任务 ID scope。
 * 团队约定格式：`feat(T2-03): xxx`、`fix(T0-01): xxx`（scope 为任务清单 ID，大小写不限制）。
 * @type {import('@commitlint/types').UserConfig}
 */
export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    // 允许任务 ID 作为 scope（如 T2-03 含大写与连字符）
    'scope-case': [0],
    // 中文 subject 不受英文大小写规则约束
    'subject-case': [0],
    'type-enum': [
      2,
      'always',
      [
        'feat',
        'fix',
        'docs',
        'style',
        'refactor',
        'perf',
        'test',
        'build',
        'ci',
        'chore',
        'revert',
      ],
    ],
  },
}

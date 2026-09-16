/* ============================================================
 * 魔音工坊 · 官方音色数据（36 个）
 * 来源：docs/01-StepAudio3-TTS-API分析文档.md 第 3 节
 * 说明：#15 cixingnansheng 官方中文名为「磁性男声」，
 *       但按 ID 拼音实为女声，此处修正为女声并保留官方 ID。
 * ============================================================ */
(function (global) {
  'use strict';

  /** @typedef {{id: string, name: string, gender: 'male'|'female', scenes: string[]}} Voice */

  /** @type {Voice[]} */
  const VOICES = [
    { id: 'vibrant-youth',           name: '活力青年',     gender: 'male',   scenes: ['youshengshu'] },
    { id: 'lively-girl',             name: '活泼少女',     gender: 'female', scenes: ['tongyong', 'youshengshu'] },
    { id: 'soft-spoken-gentleman',   name: '温言绅士',     gender: 'male',   scenes: ['xuniren'] },
    { id: 'magnetic-voiced-male',    name: '磁性男声',     gender: 'male',   scenes: ['xuniren'] },
    { id: 'zixinnansheng',           name: '自信男声',     gender: 'male',   scenes: ['youshengshu'] },
    { id: 'elegantgentle-female',    name: '儒雅女性',     gender: 'female', scenes: ['youshengshu'] },
    { id: 'livelybreezy-female',     name: '活泼飒爽女声', gender: 'female', scenes: ['xuniren'] },
    { id: 'wenrounansheng',          name: '温柔男声',     gender: 'male',   scenes: ['xuniren'] },
    { id: 'wenrougongzi',            name: '温柔公子',     gender: 'male',   scenes: ['xuniren'] },
    { id: 'yuanqinansheng',          name: '元气男声',     gender: 'male',   scenes: ['tongyong', 'youshengshu'] },
    { id: 'jingdiannvsheng',         name: '经典女声',     gender: 'female', scenes: ['tongyong', 'youshengshu'] },
    { id: 'wenroushunv',             name: '温柔淑女',     gender: 'female', scenes: ['xuniren'] },
    { id: 'tianmeinvsheng',          name: '甜美女声',     gender: 'female', scenes: ['tongyong', 'youshengshu'] },
    { id: 'qingchunshaonv',          name: '青春少女',     gender: 'female', scenes: ['xuniren'] },
    { id: 'cixingnansheng',          name: '磁性女声',     gender: 'female', scenes: ['youshengshu'] },
    { id: 'yuanqishaonv',            name: '元气少女',     gender: 'female', scenes: ['xuniren'] },
    { id: 'linjiajiejie',            name: '邻家姐姐',     gender: 'female', scenes: ['youshengshu'] },
    { id: 'zhengpaiqingnian',        name: '正派青年',     gender: 'male',   scenes: ['youshengshu'] },
    { id: 'qingniandaxuesheng',      name: '青年大学生',   gender: 'male',   scenes: ['youshengshu'] },
    { id: 'boyinnansheng',           name: '播音男声',     gender: 'male',   scenes: ['youshengshu'] },
    { id: 'ruyananshi',              name: '儒雅老师',     gender: 'male',   scenes: ['youshengshu'] },
    { id: 'shenchennanyin',          name: '深沉男音',     gender: 'male',   scenes: ['youshengshu'] },
    { id: 'qinqienvsheng',           name: '亲切女声',     gender: 'female', scenes: ['tongyong', 'youshengshu'] },
    { id: 'wenrounvsheng',           name: '温柔女声',     gender: 'female', scenes: ['youshengshu'] },
    { id: 'jilingshaonv',            name: '机灵少女',     gender: 'female', scenes: ['youshengshu'] },
    { id: 'ruanmengnvsheng',         name: '软萌女声',     gender: 'female', scenes: ['youshengshu'] },
    { id: 'youyanvsheng',            name: '优雅女声',     gender: 'female', scenes: ['youshengshu'] },
    { id: 'lengyanyujie',            name: '冷艳御姐',     gender: 'female', scenes: ['youshengshu'] },
    { id: 'shuangkuaijiejie',        name: '爽快姐姐',     gender: 'female', scenes: ['youshengshu'] },
    { id: 'wenjingxuejie',           name: '文静学姐',     gender: 'female', scenes: ['youshengshu'] },
    { id: 'linjiameimei',            name: '邻家妹妹',     gender: 'female', scenes: ['youshengshu'] },
    { id: 'zhixingjiejie',           name: '知性姐姐',     gender: 'female', scenes: ['youshengshu'] },
    { id: 'shuangkuainansheng',      name: '爽快男声',     gender: 'male',   scenes: ['youshengshu'] },
    { id: 'ganliannvsheng',          name: '干练女声',     gender: 'female', scenes: ['youshengshu'] },
    { id: 'qinhenvsheng',            name: '亲禾女声',     gender: 'female', scenes: ['youshengshu'] },
    { id: 'huolinvsheng',            name: '活力女声',     gender: 'female', scenes: ['youshengshu'] },
  ];

  /** 筛选器分组定义（scenes 字段取值与之一一对应） */
  const GROUPS = [
    { key: 'all',        label: '全部',   match: () => true },
    { key: 'male',       label: '男声',   match: (v) => v.gender === 'male' },
    { key: 'female',     label: '女声',   match: (v) => v.gender === 'female' },
    { key: 'youshengshu', label: '有声书', match: (v) => v.scenes.includes('youshengshu') },
    { key: 'xuniren',    label: '虚拟人', match: (v) => v.scenes.includes('xuniren') },
  ];

  /** 场景中文标签映射 */
  const SCENE_LABELS = {
    tongyong: '通用',
    youshengshu: '有声书',
    xuniren: '虚拟人',
  };

  /** voice_label 可选值（docs/01 第 2.4 节） */
  const VOICE_LABEL_OPTIONS = {
    language: ['中文', '英文', '中英混合', '日文'],
    emotion: ['高兴', '非常高兴', '悲伤', '生气', '非常生气', '撒娇', '恐惧', '惊讶', '兴奋', '钦佩', '困惑', '冷漠', '尴尬', '沮丧', '骄傲'],
    style: ['温柔', '甜美', '豪爽', '严肃', '傲慢', '老年', '吼叫', '阴阳怪气', '磕巴', '慢速', '极慢', '快速', '极快'],
  };

  /** 输出格式元信息：扩展名 / 是否可在浏览器 <audio> 播放 */
  const FORMATS = {
    mp3:  { ext: 'mp3',  playable: true },
    wav:  { ext: 'wav',  playable: true },
    flac: { ext: 'flac', playable: true },
    opus: { ext: 'opus', playable: true },
    pcm:  { ext: 'pcm',  playable: false },
  };

  const SAMPLE_RATES = [8000, 16000, 22050, 24000, 48000];

  const DEFAULT_PREVIEW_TEXT = '你好，这是魔音工坊的音色试听。';

  global.MOYIN_VOICES = {
    VOICES,
    GROUPS,
    SCENE_LABELS,
    VOICE_LABEL_OPTIONS,
    FORMATS,
    SAMPLE_RATES,
    DEFAULT_PREVIEW_TEXT,
  };
})(window);

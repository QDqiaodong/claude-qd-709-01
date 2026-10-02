/**
 * 检查与病害页 —— 筛选联动回归测试。
 *
 * 覆盖：
 *  1. 初始/未选区段：病害查询不带 sectionId（全线路病害）
 *  2. 切换左侧区段：检查单与病害清单都带上新区段 id，且病害查询同时携带当前等级/销号条件
 *  3. 区段 + 严重等级 + 销号状态组合筛选
 *  4. 清空任一筛选只移除该条件，其余条件保留
 *  5. 登记病害 / 销号后刷新时维持当前筛选条件
 */
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { defineComponent, h, ref } from 'vue'
import { mount, flushPromises } from '@vue/test-utils'
import DefectView from '../src/views/DefectView.vue'

vi.mock('element-plus', () => ({ ElMessage: { success: vi.fn(), error: vi.fn() } }))

const api = vi.hoisted(() => ({
  listInspections: vi.fn(),
  createInspection: vi.fn(),
  listDefects: vi.fn(),
  createDefect: vi.fn(),
  closeDefect: vi.fn()
}))

vi.mock('../src/api', () => ({
  inspectionApi: {
    list: api.listInspections,
    create: api.createInspection
  },
  defectApi: {
    list: api.listDefects,
    create: api.createDefect,
    close: api.closeDefect
  }
}))

// ---- 轻量 Element Plus 桩：只实现本页用到的 v-model / 插槽 / 点击语义 ----

const SelectStub = defineComponent({
  name: 'ElSelect',
  props: { modelValue: { default: '' } },
  emits: ['update:modelValue', 'change'],
  setup(props, { emit, slots }) {
    return () =>
      h(
        'select',
        {
          class: 'el-select-stub',
          'data-testid': 'select',
          value: String(props.modelValue),
          onChange: (e) => {
            const raw = e.target.value
            const value = raw === '__empty__' ? '' : raw === 'true' ? true : raw === 'false' ? false : raw
            emit('update:modelValue', value)
            emit('change', value)
          }
        },
        [h('option', { value: '__empty__' }, '清空/全部'), slots.default?.()]
      )
  }
})

const OptionStub = defineComponent({
  name: 'ElOption',
  props: { label: String, value: { default: '' } },
  setup(props) {
    return () => h('option', { value: String(props.value) }, props.label)
  }
})

const TableColumnStub = defineComponent({
  name: 'ElTableColumn',
  props: { label: String, prop: String },
  setup(_, { slots, attrs }) {
    return () => {
      const row = { ...injectedRow, ...attrs }
      return h('span', { class: 'el-table-column-stub' }, slots.default?.({ row }))
    }
  }
})

// el-table 把当前行（第一条病害，取未销号的以便测销号按钮）注入给列桩
let injectedRow = {}
const TableStub = defineComponent({
  name: 'ElTable',
  props: { data: { type: Array, default: () => [] } },
  setup(props, { slots }) {
    return () => {
      injectedRow = (props.data || []).find((d) => !d.closed) || (props.data || [])[0] || {}
      return h('div', { class: 'el-table-stub' }, slots.default?.())
    }
  }
})

const ButtonStub = defineComponent({
  name: 'ElButton',
  emits: ['click'],
  setup(_, { slots, emit }) {
    return () =>
      h(
        'button',
        { type: 'button', onClick: (e) => emit('click', e) },
        slots.default?.()
      )
  }
})

const DialogStub = defineComponent({
  name: 'ElDialog',
  props: { modelValue: Boolean },
  setup(props, { slots }) {
    return () =>
      props.modelValue
        ? h('div', { class: 'el-dialog-stub' }, [slots.default?.(), slots.footer?.()])
        : null
  }
})

const simple = (name, tag) =>
  defineComponent({
    name,
    setup(_, { slots, attrs }) {
      return () => h(tag, attrs, slots.default?.())
    }
  })

const globalStubs = {
  'el-select': SelectStub,
  'el-option': OptionStub,
  'el-table': TableStub,
  'el-table-column': TableColumnStub,
  'el-button': ButtonStub,
  'el-dialog': DialogStub,
  'el-tag': simple('ElTag', 'span'),
  'el-form': simple('ElForm', 'form'),
  'el-form-item': simple('ElFormItem', 'label'),
  'el-input': simple('ElInput', 'input'),
  'el-input-number': simple('ElInputNumber', 'input'),
  'el-date-picker': simple('ElDatePicker', 'input')
}

function makeDefect(id, over) {
  return {
    id,
    inspectNo: 'INS-2026-0001',
    sectionId: 10,
    sectionNo: 'K100',
    defectTypeName: '裂纹',
    severity: 'LIGHT',
    severityName: '轻',
    severityColor: '#aaa',
    mileageText: 'K100+100',
    description: 'desc-' + id,
    foundDate: '2026-09-01',
    closed: false,
    closedName: '未销号',
    closeDate: null,
    treatment: '',
    ...over
  }
}

function mountView(sectionIdRef) {
  return mount(DefectView, {
    props: {},
    global: {
      stubs: globalStubs,
      provide: {
        works: {
          sectionId: sectionIdRef,
          sectionList: { value: [{ id: 10, sectionNo: 'K100' }] },
          reloadBoard: vi.fn().mockResolvedValue(undefined),
          reloadOverview: vi.fn().mockResolvedValue(undefined)
        }
      }
    }
  })
}

/** 触发某一个 select 桩（placeholder 区分严重等级/销号状态）的选择 */
async function pickSelect(wrapper, optionValue, placeholder) {
  const selects = wrapper.findAllComponents(SelectStub)
  const target = placeholder
    ? selects.find((s) => s.attributes('placeholder') === placeholder)
    : selects[0]
  const text = optionValue === '' ? '__empty__' : String(optionValue)
  target.vm.$el.value = text
  target.vm.$el.dispatchEvent(new Event('change'))
  await flushPromises()
}

function defectListCalls() {
  return api.listDefects.mock.calls.map((c) => c[0] || {})
}

function lastDefectParams() {
  return defectListCalls().at(-1)
}

describe('DefectView 筛选联动', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    api.listInspections.mockResolvedValue([
      { id: 1, inspectNo: 'INS-2026-0001', sectionId: 10, sectionNo: 'K100' }
    ])
    api.listDefects.mockImplementation((params = {}) => {
      const pool = [
        makeDefect(1, { sectionId: 10, severity: 'HEAVY', closed: false }),
        makeDefect(2, { sectionId: 10, severity: 'LIGHT', closed: true }),
        makeDefect(3, { sectionId: 20, severity: 'MIDDLE', closed: false })
      ]
      return Promise.resolve(
        pool.filter(
          (d) =>
            (params.sectionId == null || d.sectionId === params.sectionId) &&
            (params.severity == null || d.severity === params.severity) &&
            (params.closed == null || d.closed === params.closed)
        )
      )
    })
    api.createDefect.mockResolvedValue(makeDefect(9))
    api.closeDefect.mockResolvedValue(makeDefect(1, { closed: true }))
  })

  it('未选区段时展示全线路病害：病害与检查单查询都不带 sectionId', async () => {
    const sectionId = ref(null)
    const wrapper = mountView(sectionId)
    await flushPromises()

    expect(api.listInspections).toHaveBeenCalledWith(null)
    expect(lastDefectParams()).not.toHaveProperty('sectionId')

    // 全线路结果包含其他区段（sectionId=20）的记录
    const rows = wrapper.findAllComponents(TableStub)[1].props('data')
    expect(rows.map((d) => d.sectionId).sort()).toEqual([10, 10, 20])
  })

  it('切换左侧区段后：检查单与病害清单同时按新区段查询，不再混入其他区段', async () => {
    const sectionId = ref(null)
    const wrapper = mountView(sectionId)
    await flushPromises()
    vi.clearAllMocks()

    sectionId.value = 20
    await flushPromises()

    expect(api.listInspections).toHaveBeenCalledWith(20)
    expect(lastDefectParams()).toEqual({ sectionId: 20 })
    const rows = wrapper.findAllComponents(TableStub)[1].props('data')
    expect(rows.map((d) => d.sectionId)).toEqual([20])
  })

  it('区段 + 严重等级 + 销号状态三个条件组合下发', async () => {
    const sectionId = ref(10)
    const wrapper = mountView(sectionId)
    await flushPromises()
    vi.clearAllMocks()

    await pickSelect(wrapper, 'HEAVY', '全部等级')
    expect(lastDefectParams()).toEqual({ sectionId: 10, severity: 'HEAVY' })

    await pickSelect(wrapper, 'false', '全部销号状态')
    expect(lastDefectParams()).toEqual({ sectionId: 10, severity: 'HEAVY', closed: false })

    // mock 按组合条件过滤：只剩区段10 + 重级 + 未销号
    const rows = wrapper.findAllComponents(TableStub)[1].props('data')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ sectionId: 10, severity: 'HEAVY', closed: false })
  })

  it('清空严重等级只移除 severity，区段与销号状态保留；再清空销号状态后仍保留区段', async () => {
    const sectionId = ref(10)
    const wrapper = mountView(sectionId)
    await flushPromises()

    await pickSelect(wrapper, 'HEAVY', '全部等级')
    await pickSelect(wrapper, 'false', '全部销号状态')
    expect(lastDefectParams()).toEqual({ sectionId: 10, severity: 'HEAVY', closed: false })
    vi.clearAllMocks()

    await pickSelect(wrapper, '', '全部等级')
    expect(lastDefectParams()).toEqual({ sectionId: 10, closed: false })

    await pickSelect(wrapper, '', '全部销号状态')
    expect(lastDefectParams()).toEqual({ sectionId: 10 })
  })

  it('未选区段下组合等级/销号条件；切到区段后自动叠加 sectionId 且不丢已选条件', async () => {
    const sectionId = ref(null)
    const wrapper = mountView(sectionId)
    await flushPromises()

    await pickSelect(wrapper, 'MIDDLE', '全部等级')
    expect(lastDefectParams()).toEqual({ severity: 'MIDDLE' })

    sectionId.value = 20
    await flushPromises()
    expect(lastDefectParams()).toEqual({ sectionId: 20, severity: 'MIDDLE' })

    // 回到“未选区段”（全线路）时 sectionId 被移除，等级条件保留
    sectionId.value = null
    await flushPromises()
    expect(lastDefectParams()).toEqual({ severity: 'MIDDLE' })
  })

  it('登记病害后刷新仍保持当前区段+等级+销号条件', async () => {
    const sectionId = ref(10)
    const wrapper = mountView(sectionId)
    await flushPromises()
    await pickSelect(wrapper, 'HEAVY', '全部等级')
    await pickSelect(wrapper, 'false', '全部销号状态')
    vi.clearAllMocks()

    // 打开“登记病害”弹窗 → 确认登记
    wrapper.findAll('button').find((b) => b.text().includes('登记病害')).trigger('click')
    await flushPromises()
    wrapper.findAll('button').find((b) => b.text() === '登记').trigger('click')
    await flushPromises()

    expect(api.createDefect).toHaveBeenCalledTimes(1)
    expect(lastDefectParams()).toEqual({ sectionId: 10, severity: 'HEAVY', closed: false })
  })

  it('销号后刷新仍保持当前筛选条件', async () => {
    const sectionId = ref(10)
    const wrapper = mountView(sectionId)
    await flushPromises()
    await pickSelect(wrapper, 'false', '全部销号状态')
    vi.clearAllMocks()

    // 病害表操作列（当前行=未销号的重级病害）点“销号”，填措施后确认
    const defectTable = wrapper.findAllComponents(TableStub)[1]
    const closeBtn = defectTable.findAll('button').find((b) => b.text().includes('销号'))
    expect(closeBtn).toBeTruthy()
    await closeBtn.trigger('click')
    await flushPromises()
    wrapper.findAll('button').find((b) => b.text() === '确认销号').trigger('click')
    await flushPromises()

    expect(api.closeDefect).toHaveBeenCalledWith(
      expect.any(Number),
      expect.objectContaining({ treatment: expect.any(String), closeDate: expect.any(String) })
    )
    expect(lastDefectParams()).toEqual({ sectionId: 10, closed: false })
  })
})

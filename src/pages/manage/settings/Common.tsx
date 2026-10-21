import { useFetch, useT, useRouter, useManageTitle } from "~/hooks"
import { Group, SettingItem, PResp, PEmptyResp, EmptyResp, Resp } from "~/types"
import {
  r,
  notify,
  getTarget,
  handleResp,
  handleRespWithoutAuthAndNotify,
} from "~/utils"
import { createStore } from "solid-js/store"
import { Button, HStack, VStack } from "@hope-ui/solid"
import { createMemo, createSignal, Index } from "solid-js"
import { Item } from "./SettingItem"
import { ResponsiveGrid } from "../common/ResponsiveGrid"
import { setSettings as renewSettings } from "~/store"

export interface CommonSettingsProps {
  group: Group
  /** 只渲染指定的设置项（不传则渲染整个分组），用于把媒体库设置拆成多个页面 */
  keys?: string[]
  /** 根据其它设置项的当前值决定某一项是否只读 */
  readOnlyKey?: (key: string, all: SettingItem[]) => boolean
}
const CommonSettings = (props: CommonSettingsProps) => {
  const t = useT()
  const { pathname } = useRouter()
  useManageTitle(`manage.sidemenu.${pathname().split("/").pop()}`)
  const [settingsLoading, getSettings] = useFetch((): PResp<SettingItem[]> =>
    r.get(`/admin/setting/list?group=${props.group}`),
  )
  const [settings, setSettings] = createStore<SettingItem[]>([])
  const refresh = async () => {
    const resp = await getSettings()
    handleResp<SettingItem[]>(resp, setSettings)
  }
  refresh()
  const [saveLoading, saveSettings] = useFetch((): PEmptyResp =>
    r.post("/admin/setting/save", getTarget(settings)),
  )
  const [defaultLoading, defaultSettings] = useFetch((): PResp<SettingItem[]> =>
    r.post(`/admin/setting/default?group=${props.group}`),
  )
  const [loading, setLoading] = createSignal(false)
  const visible = createMemo(() => {
    if (!props.keys?.length) return settings
    // 按调用方给定的顺序输出，保证设置项可以自由排序
    const map = new Map(settings.map((item) => [item.key, item]))
    return props.keys
      .map((key) => map.get(key))
      .filter((item): item is SettingItem => !!item)
  })
  return (
    <VStack w="$full" alignItems="start" spacing="$2">
      <ResponsiveGrid>
        <Index each={visible()}>
          {(item) => (
            <Item
              {...item()}
              readOnly={props.readOnlyKey?.(item().key, settings) === true}
              onChange={(val) => {
                setSettings((i) => item().key === i.key, "value", val)
              }}
              onDelete={async () => {
                setLoading(true)
                const resp: EmptyResp = await r.post(
                  `/admin/setting/delete?key=${item().key}`,
                )
                setLoading(false)
                handleResp(resp, () => {
                  notify.success(t("global.delete_success"))
                  refresh()
                })
              }}
            />
          )}
        </Index>
      </ResponsiveGrid>
      <HStack spacing="$2">
        <Button
          colorScheme="accent"
          onClick={refresh}
          loading={settingsLoading() || loading() || defaultLoading()}
        >
          {t("global.refresh")}
        </Button>
        <Button
          loading={saveLoading()}
          onClick={async () => {
            const resp = await saveSettings()
            handleResp(resp, async () => {
              notify.success(t("global.save_success"))
              handleRespWithoutAuthAndNotify(
                (await r.get("/public/settings")) as Resp<
                  Record<string, string>
                >,
                renewSettings,
              )
            })
          }}
        >
          {t("global.save")}
        </Button>
        <Button
          colorScheme="warning"
          loading={settingsLoading() || loading() || defaultLoading()}
          onClick={async () => {
            const resp = await defaultSettings()
            handleResp(resp, (data) => {
              notify.info(t("manage.load_default_setting_success"))
              setSettings(data)
            })
          }}
        >
          {t("manage.load_default_setting")}
        </Button>
      </HStack>
    </VStack>
  )
}

export default CommonSettings

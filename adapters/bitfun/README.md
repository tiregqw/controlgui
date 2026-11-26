# BitFun host adapter

This single patch consolidates the ControlGUI host integration against the following clean upstream revision:

- Upstream: https://github.com/GCWing/OpenBitFun
- Base commit: `c2802998aaccc41362f9f396bcdb500485c4e66a`

```sh
git clone https://github.com/GCWing/OpenBitFun.git
cd OpenBitFun
git switch --detach c2802998aaccc41362f9f396bcdb500485c4e66a
git switch -c controlgui-integration
git apply --check /path/to/controlgui/adapters/bitfun/controlgui-bitfun.patch
git apply /path/to/controlgui/adapters/bitfun/controlgui-bitfun.patch
```

Install dependencies and build/start OpenBitFun using its upstream instructions. In the embedded browser, open the plugin manager and import `assets/shared-controlgui.bitfun-plugin.json` from this repository. Enable annotation mode to pick elements. Saved notes appear in the session composer and can be submitted with ordinary text.

The patch includes the loader, native WebView adapter, toolbar, composer integration, tests, and the bundled core fallback. It does not include unrelated local application code or experimental reports. Do not apply the patch to a dirty checkout or on top of an existing ControlGUI integration. If a compatible loader is already installed, simply import the new shared JSON. The native desktop and actual Agent end-to-end flow require further acceptance testing.

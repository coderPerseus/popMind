{
  "targets": [
    {
      "target_name": "selection_bridge",
      "sources": ["native/selection_bridge.mm"],
      "include_dirs": [
        "<!@(node -p \"require('node-addon-api').include\")"
      ],
      "dependencies": [
        "<!(node -p \"require('node-addon-api').gyp\")"
      ],
      "defines": ["NAPI_CPP_EXCEPTIONS"],
      "cflags_cc!": ["-fno-exceptions"],
      "xcode_settings": {
        "GCC_ENABLE_CPP_EXCEPTIONS": "YES",
        "CLANG_CXX_LIBRARY": "libc++",
        "MACOSX_DEPLOYMENT_TARGET": "11.0",
        "OTHER_LDFLAGS": [
          "-framework",
          "ApplicationServices",
          "-framework",
          "AppKit",
          "-framework",
          "Vision"
        ]
      }
    }
  ]
}

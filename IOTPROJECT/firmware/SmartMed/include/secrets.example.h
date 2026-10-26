#pragma once
// Copy to secrets.h (ignored by Git). Provision your own actual values.
constexpr char WIFI_SSID[] = "";
constexpr char WIFI_PASSWORD[] = "";
constexpr char API_BASE_URL[] = "https://YOUR-HOST/api/v1";
constexpr char DEVICE_ID[] = "";
constexpr char DEVICE_TOKEN[] = "";
// PEM root CA that validates the HTTPS server. Never use setInsecure().
constexpr char TLS_ROOT_CA[] = R"PEM()PEM";
constexpr bool USE_RTC = false; // Set true only after installing the optional DS3231.

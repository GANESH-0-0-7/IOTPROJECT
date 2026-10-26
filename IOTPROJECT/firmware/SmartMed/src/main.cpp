// #include <Arduino.h>
// #include <ArduinoJson.h>
// #include <WiFi.h>
// #include <WiFiClientSecure.h>
// #include <HTTPClient.h>
// #include <LittleFS.h>
// #include <Preferences.h>
// #include <RTClib.h>
// #include <Wire.h>
// #include <sys/time.h>
// #include <time.h>
// #if __has_include("secrets.h")
// #include "secrets.h"
// #else
// #include "secrets.example.h"
// #endif

// // Classic ESP32-WROOM-32 pin plan. ECHO requires the documented 5 V divider.
// constexpr int TRIG_PIN=18, ECHO_PIN=34, BUZZER_PIN=32;
// const int LED_PINS[]={13,14,26,27};
// const char* SLOT_IDS[]={"morning","afternoon","evening","night"};
// constexpr size_t MAX_EVENTS=64;
// SemaphoreHandle_t stateLock;
// Preferences prefs;
// RTC_DS3231 rtc;
// bool rtcReady=false,storageHealthy=true,sensorHealthy=false;
// JsonDocument configDoc,reminderDoc,queueDoc,accessedDoc,pendingEvent;
// uint64_t sequenceNumber=0;
// String bootId;
// String lidState="UNKNOWN",candidate="UNKNOWN",activeId="";
// int activeSlot=-1;
// float lastDistance=-1;
// uint32_t candidateSince=0,lastSensor=0,lastValid=0,lastBuzz=0,buzzUntil=0;
// bool buzzerOn=false;

// struct Lock { Lock(){xSemaphoreTake(stateLock,portMAX_DELAY);} ~Lock(){xSemaphoreGive(stateLock);} };
// bool validClock(){return time(nullptr)>1704067200;}
// String isoNow(){time_t now=time(nullptr);struct tm utc;gmtime_r(&now,&utc);char out[25];strftime(out,sizeof(out),"%Y-%m-%dT%H:%M:%SZ",&utc);return String(out);}
// time_t parseUtc(const char* text){if(!text)return 0;struct tm t={};if(!strptime(text,"%Y-%m-%dT%H:%M:%S",&t))return 0;return mktime(&t);}
// int slotIndex(const char* id){if(!id)return -1;for(int i=0;i<4;i++)if(strcmp(id,SLOT_IDS[i])==0)return i;return -1;}
// bool persist(const char* path,JsonDocument& doc){
//   String temp=String(path)+".tmp";File f=LittleFS.open(temp,"w");if(!f)return false;
//   const size_t written=serializeJson(doc,f);f.flush();f.close();
//   if(written!=measureJson(doc)||!LittleFS.rename(temp,path))return false;return true;
// }
// bool restore(const char* path,JsonDocument& doc){File f=LittleFS.open(path,"r");if(!f)return true;bool ok=!deserializeJson(doc,f);f.close();if(!ok)doc.clear();return ok;}

// bool flushPending(){
//   if(pendingEvent.isNull())return true;
//   if(queueDoc.as<JsonArray>().size()>=MAX_EVENTS){storageHealthy=false;return false;}
//   JsonDocument next;next.set(queueDoc);next.as<JsonArray>().add(pendingEvent.as<JsonObject>());
//   if(!persist("/events.json",next)){storageHealthy=false;return false;}
//   queueDoc.set(next);pendingEvent.clear();storageHealthy=true;return true;
// }
// bool logTransition(const String& state){
//   if(!validClock()){storageHealthy=false;return false;}
//   if(pendingEvent.isNull()){
//     sequenceNumber++;prefs.putULong64("sequence",sequenceNumber);
//     pendingEvent["eventId"]=bootId+"-"+String((unsigned long)sequenceNumber);
//     pendingEvent["deviceId"]=DEVICE_ID;
//     pendingEvent["type"]=state=="OPEN"?"BOX_OPENED":"BOX_CLOSED";
//     pendingEvent["occurredAt"]=isoNow();pendingEvent["sequence"]=sequenceNumber;
//     pendingEvent["timeQuality"]=rtcReady?"RTC_SYNCED":"NTP_SYNCED";
//     pendingEvent["sensorType"]="ULTRASONIC";pendingEvent["distanceCm"]=lastDistance;
//   }
//   return flushPending();
// }
// void readSensor(){
//   digitalWrite(TRIG_PIN,LOW);delayMicroseconds(2);digitalWrite(TRIG_PIN,HIGH);delayMicroseconds(10);digitalWrite(TRIG_PIN,LOW);
//   unsigned long echo=pulseIn(ECHO_PIN,HIGH,25000);
//   Lock lock;
//   if(!echo){lastDistance=-1;candidate="UNKNOWN";sensorHealthy=false;return;}
//   float distance=echo*0.0343f/2.0f;
//   if(distance<2||distance>400){lastDistance=-1;candidate="UNKNOWN";sensorHealthy=false;return;}
//   lastDistance=distance;lastValid=millis();
//   if(!(configDoc["calibrated"]|false)){sensorHealthy=false;return;}
//   sensorHealthy=true;
//   float difference=distance-(configDoc["sensor"]["closedBaselineCm"]|0.0f);
//   float openThreshold=configDoc["sensor"]["openThresholdCm"]|999.0f;
//   float closeThreshold=configDoc["sensor"]["closeThresholdCm"]|0.0f;
//   String target=difference>=openThreshold?"OPEN":difference<=closeThreshold?"CLOSED":lidState;
//   if(target=="UNKNOWN"){candidate="UNKNOWN";return;}
//   if(target!=candidate){candidate=target;candidateSince=millis();return;}
//   if(target==lidState||millis()-candidateSince<(configDoc["sensor"]["stabilityMs"]|1000U))return;
//   // Establish initial boot state without inventing a transition.
//   if(lidState=="UNKNOWN"){lidState=target;return;}
//   if(!validClock()){lidState=target;storageHealthy=false;return;}
//   if(!logTransition(target))return;
//   lidState=target;
//   if(target=="OPEN"&&activeId.length()){
//     JsonDocument next;next.set(accessedDoc);next[activeId]=true;
//     if(persist("/accessed.json",next))accessedDoc.set(next);else storageHealthy=false;
//   }
// }
// void updateOutputs(){
//   Lock lock;time_t now=time(nullptr);String nextId="";int nextSlot=-1;
//   if(validClock()&&(configDoc["calibrated"]|false)&&parseUtc(reminderDoc["validThrough"])>now&&(reminderDoc["scheduleVersion"]|0)==(configDoc["scheduleVersion"]|-1)){
//     for(JsonObject r:reminderDoc["reminders"].as<JsonArray>()){
//       if(parseUtc(r["scheduledAt"])<=now&&parseUtc(r["windowEndsAt"])>=now&&!(accessedDoc[r["id"].as<const char*>()]|false)){
//         nextId=r["id"].as<String>();nextSlot=slotIndex(r["slotId"]);break;
//       }
//     }
//   }
//   if(nextId!=activeId){activeId=nextId;activeSlot=nextSlot;lastBuzz=millis()-300000U;}
//   uint32_t repeat=(configDoc["repeatReminderMinutes"]|5U)*60000U;
//   if(activeId.length()&&millis()-lastBuzz>=repeat){lastBuzz=millis();buzzUntil=millis()+2000U;}
//   buzzerOn=activeId.length()&&(int32_t)(buzzUntil-millis())>0;
//   digitalWrite(BUZZER_PIN,buzzerOn?HIGH:LOW);
//   for(int i=0;i<4;i++)digitalWrite(LED_PINS[i],i==activeSlot&&activeId.length()&&(millis()/500)%2?HIGH:LOW);
// }
// int api(const String& route,const String& method,const String& payload,String& response){
//   if(WiFi.status()!=WL_CONNECTED||!validClock()||strlen(TLS_ROOT_CA)<64||!String(API_BASE_URL).startsWith("https://"))return -1;
//   WiFiClientSecure client;client.setCACert(TLS_ROOT_CA);client.setTimeout(5);
//   HTTPClient http;http.setConnectTimeout(5000);http.setTimeout(5000);
//   if(!http.begin(client,String(API_BASE_URL)+"/devices/"+DEVICE_ID+route))return -1;
//   http.addHeader("Authorization",String("Bearer ")+DEVICE_TOKEN);http.addHeader("Content-Type","application/json");
//   int code=method=="GET"?http.GET():http.POST(payload);
//   if(code>0&&code<300)response=http.getString();http.end();return code;
// }
// bool validConfig(JsonDocument& doc){
//   if(doc["deviceId"].as<String>()!=DEVICE_ID||!doc["version"].is<int>())return false;
//   if(!(doc["calibrated"]|false))return true;
//   return doc["sensor"]["closedBaselineCm"].is<float>()&&doc["sensor"]["openThresholdCm"].as<float>()>doc["sensor"]["closeThresholdCm"].as<float>()&&doc["sensor"]["stabilityMs"].as<int>()>=100;
// }
// void networkTask(void*){
//   uint32_t lastConfig=0,lastHeartbeat=0,lastUpload=0;uint32_t retryMs=2000;
//   for(;;){
//     if(WiFi.status()!=WL_CONNECTED){WiFi.reconnect();vTaskDelay(pdMS_TO_TICKS(5000));continue;}
//     if(!validClock()){vTaskDelay(pdMS_TO_TICKS(1000));continue;}
//     uint32_t now=millis();String response;
//     if(!lastConfig||now-lastConfig>=60000){
//       lastConfig=now;
//       if(api("/config","GET","",response)==200){JsonDocument next;if(!deserializeJson(next,response)&&validConfig(next)){Lock lock;if(persist("/config.json",next)){bool changed=(configDoc["version"]|0)!=(next["version"]|0);configDoc.set(next);if(changed){lidState="UNKNOWN";candidate="UNKNOWN";}}else storageHealthy=false;}}
//       response="";
//       if(api("/reminders","GET","",response)==200){
//         JsonDocument next;bool valid=!deserializeJson(next,response)&&next["reminders"].is<JsonArray>()&&next["reminders"].as<JsonArray>().size()<=40&&parseUtc(next["validThrough"])>time(nullptr);
//         if(valid)for(JsonObject r:next["reminders"].as<JsonArray>())if(!r["id"].is<const char*>()||slotIndex(r["slotId"])<0||parseUtc(r["windowEndsAt"])<parseUtc(r["scheduledAt"]))valid=false;
//         if(valid){Lock lock;if(persist("/reminders.json",next)){
//           reminderDoc.set(next);JsonDocument keep;keep.to<JsonObject>();
//           for(JsonObject r:next["reminders"].as<JsonArray>())if(accessedDoc[r["id"].as<const char*>()]|false)keep[r["id"].as<const char*>()]=true;
//           if(persist("/accessed.json",keep))accessedDoc.set(keep);else storageHealthy=false;
//         }else storageHealthy=false;}
//       }
//     }
//     if(now-lastUpload>=retryMs){
//       lastUpload=now;JsonDocument upload;
//       {Lock lock;JsonArray out=upload["events"].to<JsonArray>();int count=0;for(JsonObject e:queueDoc.as<JsonArray>()){if(count++==20)break;out.add(e);}}
//       if(upload["events"].size()){
//         String body;serializeJson(upload,body);response="";int status=api("/events","POST",body,response);
//         JsonDocument ack;
//         if(status==200&&!deserializeJson(ack,response)&&ack["acknowledgedEventIds"].is<JsonArray>()){
//           Lock lock;JsonDocument next;JsonArray retained=next.to<JsonArray>();
//           for(JsonObject e:queueDoc.as<JsonArray>()){bool acknowledged=false;for(JsonVariant id:ack["acknowledgedEventIds"].as<JsonArray>())if(id.as<String>()==e["eventId"].as<String>())acknowledged=true;if(!acknowledged)retained.add(e);}
//           if(persist("/events.json",next)){queueDoc.set(next);storageHealthy=true;}else storageHealthy=false;
//           retryMs=2000;
//         }else retryMs=min(retryMs*2+uint32_t(esp_random()%1000),uint32_t(60000));
//       }
//     }
//     if(!lastHeartbeat||now-lastHeartbeat>=30000){
//       lastHeartbeat=now;JsonDocument beat;
//       {Lock lock;beat["firmwareVersion"]="1.0.0";beat["appliedConfigVersion"]=configDoc["version"]|0;beat["appliedScheduleVersion"]=reminderDoc["scheduleVersion"]|0;beat["clockHealthy"]=validClock();beat["queueDepth"]=queueDoc.as<JsonArray>().size();beat["lidState"]=sensorHealthy?lidState:"UNKNOWN";if(lastDistance<0)beat["distanceCm"]=nullptr;else beat["distanceCm"]=lastDistance;if(activeSlot>=0)beat["ledSlotId"]=SLOT_IDS[activeSlot];else beat["ledSlotId"]=nullptr;beat["buzzerActive"]=buzzerOn;beat["lastSequence"]=sequenceNumber;beat["sensorHealthy"]=sensorHealthy&&storageHealthy;}
//       String body;serializeJson(beat,body);api("/heartbeat","POST",body,response);
//     }
//     vTaskDelay(pdMS_TO_TICKS(250));
//   }
// }
// void setup(){
//   Serial.begin(115200);pinMode(TRIG_PIN,OUTPUT);digitalWrite(TRIG_PIN,LOW);pinMode(ECHO_PIN,INPUT);pinMode(BUZZER_PIN,OUTPUT);digitalWrite(BUZZER_PIN,LOW);
//   for(int pin:LED_PINS){pinMode(pin,OUTPUT);digitalWrite(pin,LOW);}
//   setenv("TZ","UTC0",1);tzset();stateLock=xSemaphoreCreateMutex();
//   if(!LittleFS.begin(false)){Serial.println("Storage unavailable; refusing to erase queued data. Check filesystem provisioning.");while(true)delay(1000);}
//   prefs.begin("smartmed",false);sequenceNumber=prefs.getULong64("sequence",0);
//   char boot[34];snprintf(boot,sizeof(boot),"%08lx%08lx",(unsigned long)esp_random(),(unsigned long)esp_random());bootId=boot;
//   restore("/config.json",configDoc);restore("/reminders.json",reminderDoc);
//   if(!restore("/events.json",queueDoc)||!restore("/accessed.json",accessedDoc)){Serial.println("Persistent event state is corrupt. Preserve storage and recover before use.");while(true)delay(1000);}
//   if((!queueDoc.isNull()&&!queueDoc.is<JsonArray>())||(!accessedDoc.isNull()&&!accessedDoc.is<JsonObject>())){Serial.println("Invalid persistent state shape; recover storage before use.");while(true)delay(1000);}
//   if(queueDoc.isNull())queueDoc.to<JsonArray>();if(accessedDoc.isNull())accessedDoc.to<JsonObject>();
//   if(USE_RTC){Wire.begin(21,22);rtcReady=rtc.begin();if(rtcReady&&!rtc.lostPower()&&rtc.now().year()>=2024){struct timeval t={(time_t)rtc.now().unixtime(),0};settimeofday(&t,nullptr);}}
//   WiFi.mode(WIFI_STA);if(strlen(WIFI_SSID))WiFi.begin(WIFI_SSID,WIFI_PASSWORD);
//   configTime(0,0,"pool.ntp.org","time.google.com");
//   xTaskCreatePinnedToCore(networkTask,"network",20000,nullptr,1,nullptr,0);
//   Serial.println("SmartMed started. Configure secrets.h and measured sensor calibration before use.");
// }
// void loop(){
//   updateOutputs();
//   if(millis()-lastSensor>=100){lastSensor=millis();readSensor();}
//   static uint32_t rtcSync=0;if(rtcReady&&validClock()&&(!rtcSync||millis()-rtcSync>3600000)){rtcSync=millis();rtc.adjust(DateTime((uint32_t)time(nullptr)));}
//   delay(20);
// }


#include <WiFi.h>
#include <HTTPClient.h>
#include <time.h>

// --- YOUR WI-FI CREDENTIALS ---
const char* ssid = "Monster Dhanush";
const char* password = "12345678";

// --- YOUR BACKEND API CONFIGURATION ---
// Replace YOUR_PC_LOCAL_IP with your computer's local network IP address (e.g., 192.168.1.15) 
// and ensure your Node server is running (e.g., on port 3001 or whatever port your config uses).
const char* serverUrl = "http://10.24.224.61:3001/api/v1/devices/81d7fce1-768d-4a88-b55e-2bc75c10fa36/events";

// --- YOUR GENERATED DEVICE CREDENTIALS ---
const char* deviceId = "81d7fce1-768d-4a88-b55e-2bc75c10fa36";
const char* deviceToken = "vf_6pvftSgkmEWMZXNv1yIzb2uc9-vbHr2LmuaiuCO8";

// --- PIN DEFINITIONS ---
const int TRIG_PIN = 5;
const int ECHO_PIN = 18;
const int BLUE_LED = 21; // Wi-Fi status / System Ready
const int RED_LED = 19;  // Lid Open / Active Reminder
const int BUZZER = 23;   // Audio alert

// --- THRESHOLDS ---
const int LID_CLOSED_THRESHOLD = 15; // Distance in cm when lid is closed
bool isLidOpen = false;

void setupTime() {
  configTime(0, 0, "pool.ntp.org", "time.nist.gov");
  Serial.print("Waiting for NTP time sync: ");
  while (time(nullptr) < 1000000000) {
    delay(500);
    Serial.print(".");
  }
  Serial.println("\nTime synchronized.");
}

String getISO8601Time() {
  time_t now = time(nullptr);
  struct tm* ptm = gmtime(&now);
  char buf[30];
  strftime(buf, sizeof(buf), "%Y-%m-%dT%H:%M:%SZ", ptm);
  return String(buf);
}

void setup() {
  Serial.begin(115200);

  pinMode(TRIG_PIN, OUTPUT);
  pinMode(ECHO_PIN, INPUT);
  pinMode(BLUE_LED, OUTPUT);
  pinMode(RED_LED, OUTPUT);
  pinMode(BUZZER, OUTPUT);

  // Connect to Wi-Fi
  WiFi.begin(ssid, password);
  Serial.print("Connecting to Wi-Fi");
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    digitalWrite(BLUE_LED, !digitalRead(BLUE_LED)); // Blink blue while connecting
    Serial.print(".");
  }
  
  Serial.println("\nConnected to Wi-Fi!");
  digitalWrite(BLUE_LED, HIGH); // Solid blue = Connected and ready

  setupTime();
}

long getDistance() {
  digitalWrite(TRIG_PIN, LOW);
  delayMicroseconds(2);
  digitalWrite(TRIG_PIN, HIGH);
  delayMicroseconds(10);
  digitalWrite(TRIG_PIN, LOW);

  long duration = pulseIn(ECHO_PIN, HIGH);
  long distance = duration * 0.034 / 2;
  return distance;
}

void sendLidEvent(String eventType) {
  if (WiFi.status() == WL_CONNECTED) {
    HTTPClient http;
    http.begin(serverUrl);
    
    // Headers required by your backend
    http.addHeader("Content-Type", "application/json");
    http.addHeader("Authorization", String("Bearer ") + deviceToken);

    // Generate unique event tracking data
    String eventId = String(millis());
    String occurredAt = getISO8601Time();

    // Construct JSON payload expected by schemas.eventsBody
    String payload = "{";
    payload += "\"events\": [{";
    payload += "\"deviceId\": \"" + String(deviceId) + "\",";
    payload += "\"eventId\": \"" + eventId + "\",";
    payload += "\"type\": \"" + eventType + "\",";
    payload += "\"occurredAt\": \"" + occurredAt + "\"";
    payload += "}]";
    payload += "}";

    int httpResponseCode = http.POST(payload);

    if (httpResponseCode > 0) {
      Serial.print("Event sent successfully! Response code: ");
      Serial.println(httpResponseCode);
      String response = http.getString();
      Serial.println(response);
    } else {
      Serial.print("Error sending event POST: ");
      Serial.println(httpResponseCode);
    }
    http.end();
  }
}

void loop() {
  long distance = getDistance();
  Serial.print("Distance: ");
  Serial.print(distance);
  Serial.println(" cm");

  // Check if the lid has been opened (distance exceeds threshold)
  if (distance > LID_CLOSED_THRESHOLD && !isLidOpen) {
    isLidOpen = true;
    digitalWrite(RED_LED, HIGH);
    tone(BUZZER, 1000, 200); // Quick feedback beep
    
    Serial.println("Lid opened! Sending event to backend...");
    sendLidEvent("LID_OPENED");
    
    delay(2000); // Debounce delay
  } 
  else if (distance <= LID_CLOSED_THRESHOLD && isLidOpen) {
    isLidOpen = false;
    digitalWrite(RED_LED, LOW);
    Serial.println("Lid closed.");
    sendLidEvent("LID_CLOSED");
  }

  delay(1000); // Check sensor every second
}
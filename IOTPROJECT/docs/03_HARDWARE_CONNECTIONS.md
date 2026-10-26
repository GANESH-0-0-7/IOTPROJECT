# 3. Hardware connections

Firmware for this pin map is included in `firmware/SmartMed` (compile verification and physical testing are still outstanding). This proposed bench-build plan matches the current dashboard: **four labelled time-slot sections under one lid, one ultrasonic sensor for the whole box, four LEDs, and one external buzzer**. It has not been physically tested.

Assumptions: a classic **ESP32-WROOM-32 development board** exposing the GPIOs below, and one **5 V HC-SR04-style module with VCC/TRIG/ECHO/GND pins**. Do not reuse this plan unchanged for ESP32-C3/S3/WROVER boards or other sensors. Confirm actual board and module datasheets before assembly.

The sensor cannot identify which section was accessed. That limitation is reflected throughout the dashboard. For firmware/API details, see [02_MICROCONTROLLER_INTEGRATION.md](02_MICROCONTROLLER_INTEGRATION.md).

## 1. Components

| Part | Quantity | Purpose |
| --- | ---: | --- |
| ESP32-WROOM-32 development board | 1 | Wi-Fi, sensing, reminders |
| 5 V HC-SR04-style ultrasonic module | 1 | Shared-lid opening detection; verify fit and minimum range first |
| Indicator LEDs | 4 | Label Morning, Afternoon, Evening, Night |
| 330 Ω resistors | 4 | One per LED |
| 2.2 kΩ resistor | 1 | ECHO divider upper resistor |
| 3.3 kΩ resistor | 1 | ECHO divider lower resistor |
| 74AHCT125 DIP-14 buffer | 1 | One channel converts 3.3 V TRIG to 5 V |
| 100 nF ceramic capacitors | 2 | Near sensor and buffer power pins |
| 5 V active buzzer rated at 20 mA or less | 1 | One buzzer mounted outside the box |
| NPN transistor, e.g. 2N2222/BC337 | 1 | Buzzer driver; verify its exact lead arrangement |
| 1 kΩ and 10 kΩ resistors | 1 each | Base resistor and base pull-down |
| Flyback diode, e.g. 1N4148 | 1 if needed | Required for an inductive/magnetic buzzer |
| Regulated 5 V USB supply and cable | 1 | A reputable 1 A supply is a reasonable starting point; verify actual total load |
| Breadboard, wires, labels, enclosure | As needed | Secure and insulate final wiring |
| DS3231 clock module and compatible battery | 1 recommended | Backup timekeeping; optional for first bench test |

An HC-SR04 is relatively large and typically has a minimum measurement range around 2 cm, depending on variant. Check actual closed/open distances before buying or mounting. If using a fully 3.3 V sensor, follow its own power/interface specification instead of this 5 V plan.

## 2. Pin map

These are **GPIO numbers, not physical header pin numbers**.

| Function | ESP32 connection |
| --- | --- |
| Ultrasonic TRIG | GPIO 18 through AHCT buffer |
| Ultrasonic ECHO | GPIO 34 through voltage divider |
| Morning LED | GPIO 13 through 330 Ω |
| Afternoon LED | GPIO 14 through 330 Ω |
| Evening LED | GPIO 26 through 330 Ω |
| Night LED | GPIO 27 through 330 Ω |
| Shared buzzer driver | GPIO 32 through 1 kΩ to transistor base |
| Optional clock SDA | GPIO 21 |
| Optional clock SCL | GPIO 22 |
| Sensor/buffer/buzzer supply | Verified 5 V rail |
| Compatible clock module supply | 3.3 V |
| All grounds | Common GND |

GPIO 34 is input-only and lacks internal pull resistors; the ECHO divider supplies a ground path. This plan avoids ESP32 boot-strapping pins and flash GPIOs 6–11. GPIO 13/14 are unavailable for simultaneous JTAG use with this wiring.

## 3. Power distribution

```text
Regulated 5 V supply --> ESP32 USB connector
                              |
                 verified USB-derived 5 V pin
                              |
           +------------------+-------------------+
           |                  |                   |
       Sensor VCC        Buffer VCC           Buzzer (+)

ESP32 3.3 V ------------------------> compatible DS3231 VCC
ESP32 GND --------------------------> ALL component grounds
```

Check the development board schematic before treating a `5V`/`VIN` pin as an output. Confirm that USB-derived 5 V is exposed there and that the board power path can carry the total load. Labels differ across boards. Do not power sensors or buzzer through a GPIO or the 3.3 V regulator.

If separate peripheral power is necessary, design it according to the board schematic and share ground. Do not simultaneously feed an external 5 V pin and USB unless the board explicitly supports it. The clock battery powers only the clock, not the ESP32 or reminders.

## 4. Ultrasonic sensor wiring

### ECHO: divide 5 V to a safe input level

```text
Sensor ECHO ---- 2.2 kohm ----+---- ESP32 GPIO 34
                            |
                         3.3 kohm
                            |
                           GND
```

At 5.0 V ECHO, the junction is approximately `5 × 3.3 / (2.2 + 3.3) = 3.0 V`. Resistor order matters. **Never wire a 5 V ECHO directly to an ESP32 GPIO.**

### TRIG: use one AHCT125 channel

For standard DIP-14 74AHCT125 pin numbering, confirmed against its datasheet:

| Buffer pin | Connection |
| --- | --- |
| 14 VCC | 5 V |
| 7 GND | GND |
| 1 channel-1 output enable, active low | GND |
| 2 channel-1 input | GPIO 18 |
| 3 channel-1 output | Sensor TRIG |
| 4, 10, 13 unused output enables | 5 V, disabling unused channels |
| 5, 9, 12 unused inputs | GND, not floating |
| 6, 8, 11 unused outputs | Leave unconnected |

Place 100 nF across buffer pins 14 and 7 near the chip. A generic 74HC125 at 5 V is not an automatic substitute; AHCT logic accepts 3.3 V inputs. The buffer avoids relying on generic 5 V sensor clones accepting 3.3 V TRIG directly.

Connect sensor VCC to 5 V, GND to common ground, TRIG to buffer output 3, and ECHO to the divider. Add 100 nF across sensor VCC/GND near the module. Keep TRIG LOW when idle; add an input pull-down if required to prevent startup glitches.

## 5. Four LEDs

Repeat this circuit with each assigned GPIO and its own resistor:

```text
LED GPIO ---- 330 ohm ---- LED anode (+)
                          LED cathode (-) ---- GND
```

Morning → 13, Afternoon → 14, Evening → 26, Night → 27. Check LED polarity. HIGH lights the LED; firmware blinking identifies the scheduled slot. Use clearly printed labels as well as colour. Indicator LEDs only: high-power LEDs need a separate driver.

## 6. One external buzzer

```text
5 V ------------------------- Buzzer (+)
                              Buzzer (-)
                                   |
                              Collector (C)
GPIO 32 ---- 1 kohm ---- Base (B)   NPN
                           |  Emitter (E)
                        10 kohm    |
                           |       |
                          GND ---- GND
```

The 10 kΩ base-to-emitter resistor keeps the buzzer off at startup. Confirm the exact transistor pinout before wiring. HIGH sounds the active buzzer; LOW silences it. Use the specified low-current buzzer or redesign the driver for a larger load. A module with its own driver needs its own wiring instructions.

For an inductive/magnetic buzzer, put a flyback diode across it: striped cathode to buzzer (+)/5 V, anode to buzzer (-)/collector. A piezo load generally does not require it. Mount the buzzer outside the box or behind a suitable sound opening, with insulated wiring and strain relief.

## 7. Optional DS3231 clock

Connect VCC → 3.3 V, GND → GND, SDA → GPIO 21, SCL → GPIO 22, on a module confirmed compatible with that supply. Leave SQW/INT and 32K unused initially.

Check that I²C pull-ups go to 3.3 V, not 5 V. Use the battery type supported by the breakout. Some inexpensive boards contain charging circuits: do not charge a non-rechargeable CR2032. Prefer a documented non-charging CR2032 module or a manufacturer-approved alternative.

## 8. Mounting the single sensor

```text
       ONE SHARED LID — covers all four sections
       ----------------------------------------
                           ^
                           | clear acoustic path
                   [ultrasonic sensor]
                 protected mounting area

       Morning | Afternoon | Evening | Night
                  labelled medicine sections
```

Aim at a lid surface with adequate clearance. Keep medicine packaging out of the acoustic path and electronics separated from medicines, spills, and cleaning. Test empty, loaded, partly open, and fully open conditions.

Do not assume a missing echo means open. The lid may leave the beam, nearby surfaces may reflect it, or the sensor may be below its valid minimum range. Treat invalid readings as UNKNOWN unless a reliable alternative method is established. Calibrate measured closed/open distances, filter readings, use separate open/close thresholds, and require a stable transition. Choose thresholds from measured enclosure readings and keep them in protected firmware/backend configuration; the patient app does not expose calibration settings.

If one ultrasonic sensor cannot reliably distinguish the lid states in the chosen enclosure, revise its placement or sensing method before building the final box. The frontend event format can stay the same.

## 9. Assembly checks

1. Power off. Check breadboard rail continuity, resistor values, polarity, buffer orientation, and transistor lead order.
2. Start with ESP32 alone; verify firmware upload and serial output.
3. Add and test one LED, then all four.
4. Add the one sensor, buffer, and ECHO divider. Verify divider pulse voltage before connecting GPIO 34; an oscilloscope or appropriately rated logic analyzer can observe peaks that a multimeter may miss.
5. Log distances at known positions with bounded echo timeouts. Validate actual lid states and false-event behavior before setting thresholds.
6. Add the buzzer driver; verify silent startup and one shared alarm.
7. Add the clock; verify backup timekeeping across power loss.
8. Check stable power during Wi-Fi transmission and buzzer operation. Test with the final USB cable.
9. Implement opening/closing events and backend sync using [02_MICROCONTROLLER_INTEGRATION.md](02_MICROCONTROLLER_INTEGRATION.md).
10. Replace temporary jumpers with secure, insulated connections before enclosing.

Final acceptance: the right time-slot LED blinks and the one buzzer sounds; opening the shared lid records **Box opened**; the dashboard continues to say medicine selection/intake are **not verified**. Test power loss, offline recovery, a lid already open at startup, and opening outside a reminder window.

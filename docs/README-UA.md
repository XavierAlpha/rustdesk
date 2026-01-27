<p align="center">
  <img src="../res/logo-header.svg" alt="Camellia - Ваша віддалена стільниця"><br>
  <a href="#публічні-сервери">Сервери</a> •
  <a href="#кроки-для-збірки">Збирання</a> •
  <a href="#як-зібрати-за-допомогою-docker">Docker</a> •
  <a href="#структура-файлів">Структура</a> •
  <a href="#знімки-екрана">Знімки екрана</a><br>
  [<a href="../README.md">English</a>] | [<a href="README-CS.md">česky</a>] | [<a href="README-ZH.md">中文</a>] | [<a href="README-HU.md">Magyar</a>] | [<a href="README-ES.md">Español</a>] | [<a href="README-FA.md">فارسی</a>] | [<a href="README-FR.md">Français</a>] | [<a href="README-DE.md">Deutsch</a>] | [<a href="README-PL.md">Polski</a>] | [<a href="README-ID.md">Indonesian</a>] | [<a href="README-FI.md">Suomi</a>] | [<a href="README-ML.md">മലയാളം</a>] | [<a href="README-JP.md">日本語</a>] | [<a href="README-NL.md">Nederlands</a>] | [<a href="README-IT.md">Italiano</a>] | [<a href="README-RU.md">Русский</a>] | [<a href="README-PTBR.md">Português (Brasil)</a>] | [<a href="README-EO.md">Esperanto</a>] | [<a href="README-KR.md">한국어</a>] | [<a href="README-AR.md">العربي</a>] | [<a href="README-VN.md">Tiếng Việt</a>] | [<a href="README-DA.md">Dansk</a>] | [<a href="README-GR.md">Ελληνικά</a>] | [<a href="README-TR.md">Türkçe</a>]<br>
  <b>Нам потрібна ваша допомога для перекладу цього README, <a href="https://github.com/CamelliaCorp/camellia/tree/master/src/lang">інтерфейсу</a> та <a href="https://github.com/CamelliaCorp/camellia">документації</a> Camellia вашою рідною мовою</B>
</p>

License: GNU Affero General Public License v3.0 (AGPL-3.0). See LICENCE.


Contact: contact@aimmv.com | GitHub: https://github.com/CamelliaCorp/camellia

[![Camellia Server Pro](./assets/camellia-server-pro-badge.svg)](https://camellia.aimmv.com/pricing.html)

Ще один застосунок для віддаленого керування стільницею, написаний на Rust. Працює з коробки, не потребує налаштування. Ви повністю контролюєте свої дані, не турбуючись про безпеку. Ви можете використовувати наш сервер ретрансляції, [налаштувати свій власний](https://camellia.aimmv.com/server), або [написати свій власний сервер ретрансляції](https://github.com/CamelliaCorp/camellia).

![image](./assets/171661982-430285f0-2e12-4b1d-9957-4a58e375304d.png)

Camellia вітає внесок кожного. Ознайомтеся з [CONTRIBUTING.md](CONTRIBUTING.md), щоб отримати допомогу на початковому етапі.

[**ЧаПи**](https://github.com/CamelliaCorp/camellia/wiki/FAQ)

[**ЗАВАНТАЖЕННЯ ЗАСТОСУНКУ**](https://github.com/CamelliaCorp/camellia/releases)

[**НІЧНІ ЗБІРКИ**](https://github.com/CamelliaCorp/camellia/releases/tag/nightly)

[<img src="./assets/fdroid-badge.png"
    alt="Get it on F-Droid"
    height="80">](https://f-droid.org/en/packages/com.carriez.flutter_hbb)

## Залежності

Стільничні версії використовують Flutter чи Sciter (застаріле) для графічного інтерфейсу. Ця інструкція лише для Sciter, оскільки він є більш простим та дружнім для початківців. Перегляньте [CI](https://github.com/CamelliaCorp/camellia/blob/master/.github/workflows/flutter-build.yml) для збірки версії на Flutter.

Будь ласка, завантажте динамічну бібліотеку Sciter самостійно.

[Windows](https://raw.githubusercontent.com/c-smile/sciter-sdk/master/bin.win/x64/sciter.dll) |
[Linux](https://raw.githubusercontent.com/c-smile/sciter-sdk/master/bin.lnx/x64/libsciter-gtk.so) |
[macOS](https://raw.githubusercontent.com/c-smile/sciter-sdk/master/bin.osx/libsciter.dylib)

## Кроки для збірки

- Підготуйте середовище розробки Rust і середовище збирання C++.

- Встановіть [vcpkg](https://github.com/microsoft/vcpkg), і правильно встановіть змінну `VCPKG_ROOT`.

  - Windows: vcpkg install libvpx:x64-windows-static libyuv:x64-windows-static opus:x64-windows-static aom:x64-windows-static
  - Linux/macOS: vcpkg install libvpx libyuv opus aom

- Запустіть `cargo run`

## [Збирання](https://camellia.aimmv.com/docs/en/dev/build/)

## Як зібрати на Linux 

### Ubuntu 18 (Debian 10)

```sh
sudo apt install -y zip g++ gcc git curl wget nasm yasm libgtk-3-dev clang libxcb-randr0-dev libxdo-dev \
        libxfixes-dev libxcb-shape0-dev libxcb-xfixes0-dev libasound2-dev libpulse-dev cmake make \
        libclang-dev ninja-build libgstreamer1.0-dev libgstreamer-plugins-base1.0-dev libpam0g-dev
```

### openSUSE Tumbleweed

```sh
sudo zypper install gcc-c++ git curl wget nasm yasm gcc gtk3-devel clang libxcb-devel libXfixes-devel cmake alsa-lib-devel gstreamer-devel gstreamer-plugins-base-devel xdotool-devel pam-devel
```

### Fedora 28 (CentOS 8)

```sh
sudo yum -y install gcc-c++ git curl wget nasm yasm gcc gtk3-devel clang libxcb-devel libxdo-devel libXfixes-devel pulseaudio-libs-devel cmake alsa-lib-devel gstreamer1-devel gstreamer1-plugins-base-devel pam-devel
```

### Arch (Manjaro)

```sh
sudo pacman -Syu --needed unzip git cmake gcc curl wget yasm nasm zip make pkg-config clang gtk3 xdotool libxcb libxfixes alsa-lib pipewire
```

### Встановлення vcpkg

```sh
git clone https://github.com/microsoft/vcpkg
cd vcpkg
git checkout 2023.04.15
cd ..
vcpkg/bootstrap-vcpkg.sh
export VCPKG_ROOT=$HOME/vcpkg
vcpkg/vcpkg install libvpx libyuv opus aom
```

### Виправлення libvpx (для Fedora)

```sh
cd vcpkg/buildtrees/libvpx/src
cd *
./configure
sed -i 's/CFLAGS+=-I/CFLAGS+=-fPIC -I/g' Makefile
sed -i 's/CXXFLAGS+=-I/CXXFLAGS+=-fPIC -I/g' Makefile
make
cp libvpx.a $HOME/vcpkg/installed/x64-linux/lib/
cd
```

### Збирання

```sh
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source $HOME/.cargo/env
git clone https://github.com/CamelliaCorp/camellia
cd camellia
mkdir -p target/debug
wget https://raw.githubusercontent.com/c-smile/sciter-sdk/master/bin.lnx/x64/libsciter-gtk.so
mv libsciter-gtk.so target/debug
VCPKG_ROOT=$HOME/vcpkg cargo run
```

## Як зібрати за допомогою Docker

Почніть з клонування сховища та створення docker-контейнера:

```sh
git clone https://github.com/CamelliaCorp/camellia
cd camellia
docker build -t "camellia-builder" .
```

Надалі щоразу, коли вам буде потрібно зібрати застосунок, запускайте таку команду:

```sh
docker run --rm -it -v $PWD:/home/user/camellia -v camellia-git-cache:/home/user/.cargo/git -v camellia-registry-cache:/home/user/.cargo/registry -e PUID="$(id -u)" -e PGID="$(id -g)" camellia-builder
```

Зверніть увагу, що перша збірка може зайняти більше часу, перш ніж залежності будуть кешовані, але наступні збірки будуть виконуватися швидше. Крім того, якщо вам потрібно вказати інші аргументи для команди збірки, ви можете зробити це в кінці команди у змінній `<OPTIONAL-ARGS>`. Наприклад, якщо ви хочете створити оптимізовану версію, ви маєте запустити наведену вище команду і в кінці рядка додати `--release`. Отриманий виконуваний файл буде доступний у цільовій папці вашої системи і може бути запущений за допомогою:

```sh
target/debug/camellia
```

Або, якщо ви використовуєте виконуваний файл релізу:

```sh
target/release/camellia
```

Будь ласка, переконайтеся, що ви запускаєте ці команди з кореня сховища Camellia, інакше додаток не зможе знайти необхідні ресурси. Також зверніть увагу, що інші cargo підкоманди, такі як `install` або `run`, наразі не підтримуються цим методом, оскільки вони будуть встановлювати або запускати програму всередині контейнера, а не на хості.

## Структура файлів

- **[libs/hbb_common](https://github.com/CamelliaCorp/camellia/tree/master/libs/hbb_common)**: відеокодек, конфіг, обгортка tcp/udp, protobuf, функції fs для передавання файлів і деякі інші службові функції
- **[libs/scrap](https://github.com/CamelliaCorp/camellia/tree/master/libs/scrap)**: захоплення екрана
- **[libs/enigo](https://github.com/CamelliaCorp/camellia/tree/master/libs/enigo)**: специфічне для платформи керування клавіатурою/мишею
- **[libs/clipboard](https://github.com/CamelliaCorp/camellia/tree/master/libs/clipboard)**: реалізація копіювання та вставлення файлів для Windows, Linux, macOS.
- **[src/ui](https://github.com/CamelliaCorp/camellia/tree/master/src/ui)**: графічний інтерфейс користувача
- **[src/server](https://github.com/CamelliaCorp/camellia/tree/master/src/server)**: сервіси аудіо/буфера обміну/вводу/відео та мережевих підключень
- **[src/client.rs](https://github.com/CamelliaCorp/camellia/tree/master/src/client.rs)**: однорангове зʼєднання
- **[src/rendezvous_mediator.rs](https://github.com/CamelliaCorp/camellia/tree/master/src/rendezvous_mediator.rs)**: комунікація з [Camellia server](https://github.com/CamelliaCorp/camellia), очікування віддаленого прямого (обхід TCP NAT) або ретрансльованого зʼєднання
- **[src/platform](https://github.com/CamelliaCorp/camellia/tree/master/src/platform)**: специфічний для платформи код
- **[flutter](https://github.com/CamelliaCorp/camellia/tree/master/flutter)**: код Flutter для мобільних пристроїв 
- **[flutter/web/js](https://github.com/CamelliaCorp/camellia/tree/master/flutter/web/js)**: JavaScript для веб клієнта на Flutter

## Знімки екрана

![Менеджер зʼєднань](./assets/113112362-ae4deb80-923b-11eb-957d-ff88daad4f06.png)
![Підключення до ПК з Windows](./assets/113112619-f705a480-923b-11eb-911d-97e984ef52b6.png)
![Передача файлів](./assets/113112857-3fbd5d80-923c-11eb-9836-768325faf906.png)
![Тунелювання TCP](./assets/135385039-38fdbd72-379a-422d-b97f-33df71fb1cec.png)


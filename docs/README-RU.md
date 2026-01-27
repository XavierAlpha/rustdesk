<p align="center">
  <img src="../res/logo-header.svg" alt="Camellia - Ваш удаленый рабочий стол"><br>
  <a href="#первичные-шаги-для-сборки">Первичные шаги для сборки</a>
  <a href="#как-собрать-с-помощью-Docker">Как собрать с помощью Docker</a>
  <a href="#структура-файлов">Структура файлов</a>
  <br>
  [<a href="../README.md">English</a>] | [<a href="README-UA.md">Українська</a>] | [<a href="README-CS.md">česky</a>] | [<a href="README-ZH.md">中文</a>] | [<a href="README-HU.md">Magyar</a>] | [<a href="README-ES.md">Español</a>] | [<a href="README-FA.md">فارسی</a>] | [<a href="README-FR.md">Français</a>] | [<a href="README-DE.md">Deutsch</a>] | [<a href="README-PL.md">Polski</a>] | [<a href="README-ID.md">Indonesian</a>] | [<a href="README-FI.md">Suomi</a>] | [<a href="README-ML.md">മലയാളം</a>] | [<a href="README-JP.md">日本語</a>] | [<a href="README-NL.md">Nederlands</a>] | [<a href="README-IT.md">Italiano</a>] | [<a href="README-PTBR.md">Português (Brasil)</a>] | [<a href="README-EO.md">Esperanto</a>] | [<a href="README-KR.md">한국어</a>] | [<a href="README-AR.md">العربي</a>] | [<a href="README-VN.md">Tiếng Việt</a>] | [<a href="README-GR.md">Ελληνικά</a>] •
  <a href="#скриншоты">Скриншоты</a><br>
  <b>Нам нужна ваша помощь в переводе этого README, <a href="https://github.com/CamelliaCorp/camellia/tree/master/src/lang">интерфейса Camellia</a>
     и <a href="https://github.com/CamelliaCorp/camellia">документации Camellia</a> на ваш родной язык.</b>
</p>

License: GNU Affero General Public License v3.0 (AGPL-3.0). See LICENCE.


> [!Caution]
> **Отказ от ответственности за неправомерное использование** <br>
> Разработчики Camellia не одобряют и не поддерживают какое-либо неэтичное или незаконное использование данного программного обеспечения. Неправомерное использование (несанкционированный доступ, контроль или вторжение в частную жизнь) строго противоречит нашим правилам. Авторы не несут ответственности за любое неправомерное использование приложения.

Contact: contact@aimmv.com | GitHub: https://github.com/CamelliaCorp/camellia

[![Camellia Server Pro](./assets/camellia-server-pro-badge.svg)](https://camellia.aimmv.com/pricing.html)

Ещё одно программное обеспечение для удаленного рабочего стола, написанное на Rust. Работает из коробки, настройки не требует. Вы полностью контролируете свои данные, не беспокоясь о безопасности. Вы можете использовать наш сервер ретрансляции, [настроить свой собственный](https://camellia.aimmv.com/server), или [написать свой](https://github.com/CamelliaCorp/camellia).

![image](./assets/171661982-430285f0-2e12-4b1d-9957-4a58e375304d.png)

Camellia приветствует вклад каждого. Ознакомьтесь с [`docs/CONTRIBUTING-RU.md`](CONTRIBUTING-RU.md) в начале работы для понимания.

[**Как работает Camellia?**](https://github.com/CamelliaCorp/camellia/wiki/How-does-Camellia-work%3F) (Документация на английском языке)

[**Часто задаваемые вопросы**](https://github.com/CamelliaCorp/camellia/wiki/FAQ) (Страница на английском языке)

[**СКАЧАТЬ ПРИЛОЖЕНИЕ**](https://github.com/CamelliaCorp/camellia/releases)

[**НОЧНЫЕ СБОРКИ (Актуальные)**](https://github.com/CamelliaCorp/camellia/releases/tag/nightly)

[<img src="./assets/fdroid-badge.png"
    alt="Get it on F-Droid"
    height="80">](https://f-droid.org/en/packages/com.carriez.flutter_hbb)
[<img src="./assets/flathub-badge.svg"
    alt="Get it on Flathub"
    height="80">](https://flathub.org/apps/com.camellia.Camellia)

## Зависимости

Для ПК-версии используются библиотеки Flutter или Sciter (устаревшее) для графического интерфейса. Данное руководство подразумевает работу с Sciter, так как он более простой в использовании и с ним легче начать работу. Вы можете также посмотреть на механизм нашего [CI](https://github.com/CamelliaCorp/camellia/blob/master/.github/workflows/flutter-build.yml) для сборок на Flutter.

Загрузите динамическую библиотеку Flutter самостоятельно.

[Windows](https://raw.githubusercontent.com/c-smile/sciter-sdk/master/bin.win/x64/sciter.dll) |
[Linux](https://raw.githubusercontent.com/c-smile/sciter-sdk/master/bin.lnx/x64/libsciter-gtk.so) |
[macOS](https://raw.githubusercontent.com/c-smile/sciter-sdk/master/bin.osx/libsciter.dylib)

## Первичные шаги для сборки

- Подготовьте среду разработки Rust и среду сборки C++.

- Установите [vcpkg](https://github.com/microsoft/vcpkg), и правильно установите переменную `VCPKG_ROOT`

  - Windows: vcpkg install libvpx:x64-windows-static libyuv:x64-windows-static opus:x64-windows-static aom:x64-windows-static
  - Linux/macOS: vcpkg install libvpx libyuv opus aom

- Выполните команду `cargo run`

## [Сборка](https://camellia.aimmv.com/docs/ru/dev/build/)

## Как собрать на Linux 

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

### Установка vcpkg

```sh
git clone https://github.com/microsoft/vcpkg
cd vcpkg
git checkout 2023.04.15
cd ..
vcpkg/bootstrap-vcpkg.sh
export VCPKG_ROOT=$HOME/vcpkg
vcpkg/vcpkg install libvpx libyuv opus aom
```

### Исправление libvpx (для Fedora)

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

### Сборка

```sh
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source $HOME/.cargo/env
git clone --recurse-submodules https://github.com/CamelliaCorp/camellia
cd camellia
mkdir -p target/debug
wget https://raw.githubusercontent.com/c-smile/sciter-sdk/master/bin.lnx/x64/libsciter-gtk.so
mv libsciter-gtk.so target/debug
VCPKG_ROOT=$HOME/vcpkg cargo run
```

## Как собрать с помощью Docker

Начните с клонирования репозитория и создания docker-контейнера:

```sh
git clone https://github.com/CamelliaCorp/camellia
cd camellia
git submodule update --init --recursive
docker build -t "camellia-builder" .
```

Затем при каждой сборке приложения выполняйте следующую команду:

```sh
docker run --rm -it -v $PWD:/home/user/camellia -v camellia-git-cache:/home/user/.cargo/git -v camellia-registry-cache:/home/user/.cargo/registry -e PUID="$(id -u)" -e PGID="$(id -g)" camellia-builder
```

Обратите внимание, что первая сборка может занять больше времени, прежде чем зависимости будут кэшированы, но последующие сборки будут выполняться быстрее. Кроме того, если вам нужно указать другие аргументы для команды сборки, вы можете сделать это в конце команды в переменной `<OPTIONAL-ARGS>`. Например, если вы хотите создать оптимизированную версию, вы должны выполнить приведенную выше команду и в конце строки добавить `--release`. Полученный исполняемый файл будет доступен в целевой папке вашей системы и может быть запущен с помощью следующей команды:

```sh
target/debug/camellia
```

Или, если вы используете исполняемый файл релиза:

```sh
target/release/camellia
```

Пожалуйста, убедитесь, что вы запускаете эти команды из корня репозитория Camellia, иначе приложение не сможет найти необходимые ресурсы. Также обратите внимание, что другие подкоманды Cargo, такие как `install` или `run`, в настоящее время не поддерживаются этим методом, поскольку они будут устанавливать или запускать программу внутри контейнера, а не на хосте.

## Структура файлов

- **[libs/hbb_common](https://github.com/CamelliaCorp/camellia/tree/master/libs/hbb_common)**: видеокодек, конфигурация, враппер TCP/UDP, protobuf, функции файловой системы для передачи файлов и некоторые другие служебные функции
- **[libs/scrap](https://github.com/CamelliaCorp/camellia/tree/master/libs/scrap)**: захват экрана
- **[libs/enigo](https://github.com/CamelliaCorp/camellia/tree/master/libs/enigo)**: специфичное для платформы управление клавиатурой/мышью
- **[libs/clipboard](https://github.com/CamelliaCorp/camellia/tree/master/libs/clipboard)**: функционал буфера обмена файлами для Windows, Linux, и macOS
- **[src/ui](https://github.com/CamelliaCorp/camellia/tree/master/src/ui)**: графический пользовательский интерфейс на Sciter (устаревшее)
- **[src/server](https://github.com/CamelliaCorp/camellia/tree/master/src/server)**: сервисы аудио, буфера обмена, ввода, видео и сетевых подключений
- **[src/client.rs](https://github.com/CamelliaCorp/camellia/tree/master/src/client.rs)**: одноранговое соединение
- **[src/rendezvous_mediator.rs](https://github.com/CamelliaCorp/camellia/tree/master/src/rendezvous_mediator.rs)**: связь с [сервером Rustdesk](https://github.com/CamelliaCorp/camellia), ожидает удаленного прямого (через TCP hole punching) или ретранслируемого соединения
- **[src/platform](https://github.com/CamelliaCorp/camellia/tree/master/src/platform)**: специфичный для платформы код
- **[flutter](https://github.com/CamelliaCorp/camellia/tree/master/flutter)**: код Flutter для ПК-версии и мобильных устройств
- **[flutter/web/js](https://github.com/CamelliaCorp/camellia/tree/master/flutter/web/v1/js)**: JavaScript для Web-клиента Flutter








## Скриншоты

![Менеджер соединений](./assets/113112362-ae4deb80-923b-11eb-957d-ff88daad4f06.png)
![Подключение к удалённому рабочему столу на Windows](./assets/113112619-f705a480-923b-11eb-911d-97e984ef52b6.png)
![Передача файлов](./assets/113112857-3fbd5d80-923c-11eb-9836-768325faf906.png)
![TCP-туннелирование](./assets/135385039-38fdbd72-379a-422d-b97f-33df71fb1cec.png)


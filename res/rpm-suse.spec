Name:       camellia
Version:    %{?pkgver}%{!?pkgver:1.1.9}
Release:    0
Summary:    RPM package
License:    GPL-3.0
Requires:   gtk3 libxcb1 libXfixes3 alsa-utils libXtst6 libva2 pam gstreamer-plugins-base gstreamer-plugin-pipewire
Recommends: libayatana-appindicator3-1 xdotool

# https://docs.fedoraproject.org/en-US/packaging-guidelines/Scriptlets/

%description
The best open-source remote desktop client software, written in Rust.

%prep
# we have no source, so nothing here

%build
# we have no source, so nothing here

%global __python %{__python3}

%install
mkdir -p %{buildroot}/usr/bin/
mkdir -p %{buildroot}/usr/share/camellia/
mkdir -p %{buildroot}/usr/share/camellia/files/
mkdir -p %{buildroot}/usr/share/icons/hicolor/256x256/apps/
mkdir -p %{buildroot}/usr/share/icons/hicolor/scalable/apps/
install -m 755 $HBB/target/release/camellia %{buildroot}/usr/bin/camellia
install $HBB/libsciter-gtk.so %{buildroot}/usr/share/camellia/libsciter-gtk.so
install $HBB/res/camellia.service %{buildroot}/usr/share/camellia/files/
install $HBB/res/128x128@2x.png %{buildroot}/usr/share/icons/hicolor/256x256/apps/camellia.png
install $HBB/res/scalable.svg %{buildroot}/usr/share/icons/hicolor/scalable/apps/camellia.svg
install $HBB/res/camellia.desktop %{buildroot}/usr/share/camellia/files/
install $HBB/res/camellia-link.desktop %{buildroot}/usr/share/camellia/files/

%files
/usr/bin/camellia
/usr/share/camellia/libsciter-gtk.so
/usr/share/camellia/files/camellia.service
/usr/share/icons/hicolor/256x256/apps/camellia.png
/usr/share/icons/hicolor/scalable/apps/camellia.svg
/usr/share/camellia/files/camellia.desktop
/usr/share/camellia/files/camellia-link.desktop

%changelog
# let's skip this for now

%pre
# can do something for centos7
case "$1" in
  1)
    # for install
  ;;
  2)
    # for upgrade
    systemctl stop camellia || true
  ;;
esac

%post
cp /usr/share/camellia/files/camellia.service /etc/systemd/system/camellia.service
cp /usr/share/camellia/files/camellia.desktop /usr/share/applications/
cp /usr/share/camellia/files/camellia-link.desktop /usr/share/applications/
systemctl daemon-reload
systemctl enable camellia
systemctl start camellia
update-desktop-database

%preun
case "$1" in
  0)
    # for uninstall
    systemctl stop camellia || true
    systemctl disable camellia || true
    rm /etc/systemd/system/camellia.service || true
  ;;
  1)
    # for upgrade
  ;;
esac

%postun
case "$1" in
  0)
    # for uninstall
    rm /usr/share/applications/camellia.desktop || true
    rm /usr/share/applications/camellia-link.desktop || true
    update-desktop-database
  ;;
  1)
    # for upgrade
  ;;
esac

FROM debian:trixie-slim

WORKDIR /
ARG DEBIAN_FRONTEND=noninteractive
ENV VCPKG_FORCE_SYSTEM_BINARIES=1
RUN apt update -y && \
    apt install --yes --no-install-recommends \
        g++ \
        gcc \
        git \
        curl \
        cmake \
        nasm \
        yasm \
        libclang-dev \
        libdbus-1-dev \
        libgtk-3-dev \
        clang \
        libxcb-randr0-dev \
        libxdo-dev \
        libxfixes-dev \
        libxcb-shape0-dev \
        libxcb-xfixes0-dev \
        libasound2-dev \
        libpam0g-dev \
        libpulse-dev \
        libva-dev \
        libx11-dev \
        libxi-dev \
        libxtst-dev \
        make \
        wget \
        libssl-dev \
        unzip \
        zip \
        pkg-config \
        sudo \
        libgstreamer1.0-dev \
        libgstreamer-plugins-base1.0-dev \
        libglib2.0-dev \
        ca-certificates \
        ninja-build && \
        rm -rf /var/lib/apt/lists/*

RUN git clone --depth=1 https://github.com/microsoft/vcpkg && \
    /vcpkg/bootstrap-vcpkg.sh -disableMetrics && \
    /vcpkg/vcpkg --disable-metrics install libvpx libyuv opus aom

RUN groupadd -r user && \
    useradd -r -g user user --home /home/user && \
    mkdir -p /home/user/rustdesk && \
    chown -R user: /home/user && \
    echo "user ALL=(ALL) NOPASSWD:ALL" | sudo tee /etc/sudoers.d/user

USER user
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs > rustup.sh && \
    chmod +x rustup.sh && \
    ./rustup.sh -y

USER root
ENV HOME=/home/user
COPY ./entrypoint.sh /
ENTRYPOINT ["/entrypoint.sh"]

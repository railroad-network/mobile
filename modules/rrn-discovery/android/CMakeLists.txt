project(RrnDiscovery)
cmake_minimum_required(VERSION 3.9.0)

set (PACKAGE_NAME RrnDiscovery)
set (CMAKE_VERBOSE_MAKEFILE ON)
set (CMAKE_CXX_STANDARD 20)

# The only hand-written C++ here: a JNI_OnLoad that hands off to the generated
# registration. All the real work is Kotlin.
add_library(${PACKAGE_NAME} SHARED
        src/main/cpp/cpp-adapter.cpp
)

# React Native's official C++ flags, when building inside the app.
if(DEFINED REACT_ANDROID_DIR AND EXISTS "${REACT_ANDROID_DIR}/../ReactCommon/cmake-utils/react-native-flags.cmake")
        set(REACT_COMMON_DIR ${REACT_ANDROID_DIR}/../ReactCommon)
        include(${REACT_COMMON_DIR}/cmake-utils/react-native-flags.cmake)
        target_compile_reactnative_options(${PACKAGE_NAME} PRIVATE)
else()
        target_compile_definitions(${PACKAGE_NAME} PRIVATE RN_SERIALIZABLE_STATE)
endif()

# Adds the nitrogen-generated sources and headers, and defines
# BUILDING_RRNDISCOVERY_WITH_GENERATED_CMAKE_PROJECT, which the generated
# RrnDiscoveryOnLoad.cpp #errors without.
include(${CMAKE_SOURCE_DIR}/../nitrogen/generated/android/RrnDiscovery+autolinking.cmake)

include_directories(
        "src/main/cpp"
)

find_library(LOG_LIB log)

target_link_libraries(
        ${PACKAGE_NAME}
        ${LOG_LIB}
        android
)

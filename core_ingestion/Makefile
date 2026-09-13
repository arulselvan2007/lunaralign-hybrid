# ==============================================================================
# Makefile for LunarAlign-Hybrid (core_ingestion)
# ==============================================================================
#
# Usage:
#   make                - Compile the ingest_geotiff binary inside core_ingestion/
#   make clean          - Remove built objects and binary
#   make check          - Check GDAL paths and configuration
#   make help           - Display usage instructions
#
# Custom GDAL prefix example:
#   make GDAL_PREFIX=/opt/homebrew/opt/gdal
# ==============================================================================

CXX      ?= clang++
CXXFLAGS ?= -std=c++17 -O3 -Wall -Wextra

TARGET   := ingest_geotiff
SRCS     := ingest_geotiff.cpp
OBJS     := $(SRCS:.cpp=.o)

# ------------------------------------------------------------------------------
# Auto-detect GDAL compilation & linking flags on macOS
# ------------------------------------------------------------------------------
# 1. Probe gdal-config
GDAL_CONFIG := $(shell command -v gdal-config 2>/dev/null)
# 2. Probe pkg-config
PKG_CONFIG  := $(shell command -v pkg-config 2>/dev/null)
# 3. Probe Homebrew prefix
BREW_PREFIX := $(shell brew --prefix 2>/dev/null)

ifneq ($(strip $(GDAL_PREFIX)),)
  # Explicit GDAL_PREFIX provided by user
  GDAL_CFLAGS ?= -I$(GDAL_PREFIX)/include
  GDAL_LIBS   ?= -L$(GDAL_PREFIX)/lib -lgdal
else ifneq ($(GDAL_CONFIG),)
  # Detected gdal-config
  GDAL_CFLAGS ?= $(shell $(GDAL_CONFIG) --cflags 2>/dev/null)
  GDAL_LIBS   ?= $(shell $(GDAL_CONFIG) --libs 2>/dev/null)
else ifneq ($(PKG_CONFIG),)
  # Detected pkg-config
  GDAL_CFLAGS ?= $(shell $(PKG_CONFIG) --cflags gdal 2>/dev/null)
  GDAL_LIBS   ?= $(shell $(PKG_CONFIG) --libs gdal 2>/dev/null)
endif

# If flags are still empty, probe standard macOS Homebrew / MacPorts directories
ifeq ($(strip $(GDAL_CFLAGS)),)
  ifneq ($(BREW_PREFIX),)
    ifneq ($(wildcard $(BREW_PREFIX)/opt/gdal/include/gdal.h),)
      GDAL_CFLAGS := -I$(BREW_PREFIX)/opt/gdal/include
      GDAL_LIBS   := -L$(BREW_PREFIX)/opt/gdal/lib -lgdal
    else ifneq ($(wildcard $(BREW_PREFIX)/include/gdal.h),)
      GDAL_CFLAGS := -I$(BREW_PREFIX)/include
      GDAL_LIBS   := -L$(BREW_PREFIX)/lib -lgdal
    endif
  endif
endif

ifeq ($(strip $(GDAL_CFLAGS)),)
  # Apple Silicon default Homebrew path (/opt/homebrew)
  ifneq ($(wildcard /opt/homebrew/opt/gdal/include/gdal.h),)
    GDAL_CFLAGS := -I/opt/homebrew/opt/gdal/include
    GDAL_LIBS   := -L/opt/homebrew/opt/gdal/lib -lgdal
  else ifneq ($(wildcard /opt/homebrew/include/gdal.h),)
    GDAL_CFLAGS := -I/opt/homebrew/include
    GDAL_LIBS   := -L/opt/homebrew/lib -lgdal
  # Intel Mac default Homebrew path (/usr/local)
  else ifneq ($(wildcard /usr/local/opt/gdal/include/gdal.h),)
    GDAL_CFLAGS := -I/usr/local/opt/gdal/include
    GDAL_LIBS   := -L/usr/local/opt/gdal/lib -lgdal
  else ifneq ($(wildcard /usr/local/include/gdal.h),)
    GDAL_CFLAGS := -I/usr/local/include
    GDAL_LIBS   := -L/usr/local/lib -lgdal
  # MacPorts default path (/opt/local)
  else ifneq ($(wildcard /opt/local/include/gdal.h),)
    GDAL_CFLAGS := -I/opt/local/include
    GDAL_LIBS   := -L/opt/local/lib -lgdal
  else
    # Fallback to Apple Silicon Homebrew default with runtime check
    GDAL_CFLAGS := -I/opt/homebrew/include
    GDAL_LIBS   := -L/opt/homebrew/lib -lgdal
    MISSING_GDAL_WARNING := 1
  endif
endif

ALL_CXXFLAGS := $(CXXFLAGS) $(GDAL_CFLAGS)
ALL_LIBS     := $(GDAL_LIBS)

.PHONY: all clean check help

all: check $(TARGET)

$(TARGET): $(OBJS)
	@echo "Linking $@..."
	$(CXX) $(OBJS) $(ALL_LIBS) -o $@
	@echo "Build successful! Binary: core_ingestion/$(TARGET)"

%.o: %.cpp
	@echo "Compiling $<..."
	$(CXX) $(ALL_CXXFLAGS) -c $< -o $@

check:
ifeq ($(MISSING_GDAL_WARNING),1)
	@echo "----------------------------------------------------------------------"
	@echo "NOTE: GDAL headers not detected in default system paths."
	@echo "If the build fails, install GDAL via Homebrew:"
	@echo "    brew install gdal"
	@echo "Or provide the path explicitly:"
	@echo "    make GDAL_PREFIX=/path/to/gdal"
	@echo "----------------------------------------------------------------------"
endif

clean:
	@echo "Cleaning core_ingestion build artifacts..."
	rm -rf $(OBJS) $(TARGET) $(TARGET).dSYM
	@echo "Clean completed."

help:
	@echo "Makefile for LunarAlign-Hybrid core_ingestion (macOS)"
	@echo ""
	@echo "Targets:"
	@echo "  all      - Build the $(TARGET) binary (default)"
	@echo "  clean    - Remove object files, dSYM, and binary"
	@echo "  check    - Display detected compiler and GDAL flags"
	@echo "  help     - Show this help message"
	@echo ""
	@echo "Detected Configuration:"
	@echo "  CXX         : $(CXX)"
	@echo "  GDAL_CFLAGS : $(GDAL_CFLAGS)"
	@echo "  GDAL_LIBS   : $(GDAL_LIBS)"
	@echo ""
	@echo "Example execution (slices into ../data/tiles/ by default):"
	@echo "  ./$(TARGET) ../data/raw/lunar_image.tif -s 1024"

# ── Build stage ──────────────────────────────────────────────────────────────
FROM mcr.microsoft.com/dotnet/sdk:9.0 AS build
WORKDIR /src

# Copy solution + project files first for layer caching
COPY DeenTime.sln ./
COPY backend/DeenTime.Contracts/DeenTime.Contracts.csproj backend/DeenTime.Contracts/
COPY backend/DeenTime.Core/DeenTime.Core.csproj             backend/DeenTime.Core/
COPY backend/DeenTime.Infrastructure/DeenTime.Infrastructure.csproj backend/DeenTime.Infrastructure/
COPY backend/DeenTime.Api/DeenTime.Api.csproj               backend/DeenTime.Api/

RUN dotnet restore backend/DeenTime.Api/DeenTime.Api.csproj

# Copy everything else and publish
COPY . .
RUN dotnet publish backend/DeenTime.Api/DeenTime.Api.csproj \
    -c Release -o /app/publish --no-restore

# ── Runtime stage ─────────────────────────────────────────────────────────────
FROM mcr.microsoft.com/dotnet/aspnet:9.0 AS runtime
WORKDIR /app

# QuestPDF needs system fonts to render PDFs; the base image ships none.
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        libfontconfig1 \
        fonts-liberation \
        fonts-dejavu-core && \
    rm -rf /var/lib/apt/lists/*

# Create uploads dir for local storage fallback
RUN mkdir -p /app/wwwroot/uploads

COPY --from=build /app/publish .

ENV ASPNETCORE_ENVIRONMENT=Production
ENV ASPNETCORE_URLS=http://+:8080
EXPOSE 8080

ENTRYPOINT ["dotnet", "DeenTime.Api.dll"]

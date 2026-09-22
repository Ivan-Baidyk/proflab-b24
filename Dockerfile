FROM python:3.10-slim
RUN pip install flask
WORKDIR /opt/proflab-b24
CMD ["python", "app.py"]
